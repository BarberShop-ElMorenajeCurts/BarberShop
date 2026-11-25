import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedReleaseFile, fileHash, RELEASE_MANIFEST, validatePhotographyManifest, verifyRelease } from './verify-release.mjs'

function ensure(value, message) { if (!value) throw new Error(message) }
async function exists(value) { try { await fs.lstat(value); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
function contains(parent, candidate) { const relative = path.relative(parent, candidate); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) }
function literalPath(value) {
  ensure(typeof value === 'string' && value.trim() && !/[\0<>"|?*]/.test(value) && !value.split(/[\\/]/).includes('..') && !/^[\\/]{2}/.test(value) && !value.replace(/^[A-Za-z]:/, '').includes(':'), 'Especifica una ruta local literal sin segmentos .., URI ni comodines.')
  const absolute = path.resolve(value)
  ensure(absolute !== path.parse(absolute).root, 'No se admite la raíz de un volumen.')
  return absolute
}
async function noLinkedAncestors(directory) {
  const root = path.parse(directory).root
  let current = root
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const stat = await fs.lstat(current)
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'No se admiten enlaces o uniones en las rutas del paquete.')
  }
}
async function tree(directory, prefix) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`, filename = path.join(directory, entry.name), info = await fs.lstat(filename)
    ensure(!info.isSymbolicLink() && (info.isDirectory() || info.isFile()), 'La fuente contiene enlaces, uniones o archivos especiales.')
    if (info.isDirectory()) files.push(...await tree(filename, name))
    else { ensure(allowedReleaseFile(name), `Archivo no admitido en dist: ${name}`); files.push({ name, filename }) }
  }
  return files
}

const startScript = `import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRelease } from './verify-release.mjs'

const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
process.chdir(directory)
await verifyRelease(directory, { runtime: true })
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) throw new Error('Se requiere Node 22.13 o posterior.')
await import('node:sqlite')
process.env.HOST ||= '0.0.0.0'
process.env.APP_MODE ||= 'setup'
const { startServer } = await import('../server/index.mjs')
const app = await startServer()
let closing = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return
  closing = true
  await app.close()
  process.exit(0)
})
`

async function cleanupOwned(directory, parent, token) {
  const absolute = path.resolve(directory)
  ensure(path.dirname(absolute) === parent && absolute !== parent, 'Se rechazó una limpieza fuera del directorio de salida previsto.')
  const stat = await fs.lstat(absolute)
  ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'No se limpia una salida enlazada o sustituida.')
  const marker = path.join(absolute, '.release-owner')
  let owner
  try { owner = await fs.readFile(marker, 'utf8') } catch (error) {
    if (error.code !== 'ENOENT') throw error
    ensure((await fs.readdir(absolute)).length === 0, 'No se limpia un directorio no vacío sin marca propia.')
    await fs.rmdir(absolute)
    return
  }
  ensure(owner === token, 'No se limpia un directorio sin la marca propia de esta ejecución.')
  await fs.rm(absolute, { recursive: true })
}

export async function packageRelease({ destination, project = process.cwd() } = {}) {
  const root = literalPath(project), target = literalPath(destination), parent = path.dirname(target)
  await noLinkedAncestors(root); await noLinkedAncestors(parent)
  ensure(!contains(target, root), 'El destino no puede ser el proyecto ni uno de sus antecesores.')
  for (const name of ['dist', 'server', 'scripts', 'config']) {
    const source = path.join(root, name)
    ensure(!contains(source, target) && !contains(target, source), 'El destino debe estar separado de dist, server y scripts.')
    await noLinkedAncestors(source)
  }
  ensure(!await exists(target), 'El destino ya existe; no se sobrescribe.')
  await fileHash(path.join(root, 'package.json'))
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  ensure(typeof pkg.name === 'string' && pkg.name.length && typeof pkg.version === 'string' && pkg.version.length, 'El proyecto necesita name y version en package.json.')
  const sourceFiles = await tree(path.join(root, 'dist'), 'dist')
  ensure(sourceFiles.some(file => file.name === 'dist/index.html'), 'Compila el frontend: falta dist/index.html.')
  const businessFile = path.join(root, 'config/business.public.json')
  await fileHash(businessFile)
  const business = JSON.parse(await fs.readFile(businessFile, 'utf8'))
  ensure(business && typeof business === 'object' && !Array.isArray(business), 'La configuración comercial pública debe ser un objeto JSON.')
  sourceFiles.push({ name: 'config/business.public.json', filename: businessFile })
  const photographyFile = path.join(root, 'config/photography.public.json')
  await fileHash(photographyFile)
  validatePhotographyManifest(JSON.parse(await fs.readFile(photographyFile, 'utf8')), new Set(sourceFiles.map(file => file.name)))
  sourceFiles.push({ name: 'config/photography.public.json', filename: photographyFile })
  for (const entry of await fs.readdir(path.join(root, 'server'), { withFileTypes: true })) {
    const filename = path.join(root, 'server', entry.name), stat = await fs.lstat(filename)
    ensure(!stat.isSymbolicLink(), 'La fuente server contiene un enlace o unión.')
    if (entry.name.endsWith('.test.mjs')) continue
    ensure(stat.isFile() && /^[a-z][a-z0-9-]*\.mjs$/.test(entry.name), 'El perfil solo admite módulos runtime .mjs en server.')
    sourceFiles.push({ name: `server/${entry.name}`, filename })
  }
  const serverNames = new Set(sourceFiles.filter(file => file.name.startsWith('server/')).map(file => path.posix.basename(file.name)))
  for (const file of sourceFiles.filter(item => item.name.startsWith('server/'))) {
    const text = await fs.readFile(file.filename, 'utf8')
    for (const match of text.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      ensure(specifier.startsWith('node:') || ['../config/business.public.json', '../config/photography.public.json'].includes(specifier) || (specifier.startsWith('./') && serverNames.has(specifier.slice(2))), 'El servidor contiene dependencias externas o imports fuera del perfil nativo.')
    }
  }
  const deploymentPackage = { name: pkg.name, version: pkg.version, private: true, type: 'module', main: 'server/index.mjs', engines: { node: '>=22.13.0' }, scripts: { build: 'node scripts/verify-release.mjs', start: 'node scripts/start-release.mjs' }, dependencies: {} }
  const token = randomUUID(), staging = path.join(parent, `.release-stage-${token}`)
  let reserved = false, complete = false
  await fs.mkdir(staging, { mode: 0o700 })
  try {
    await fs.writeFile(path.join(staging, '.release-owner'), token, { flag: 'wx', mode: 0o600 })
    for (const file of sourceFiles) {
      const before = await fileHash(file.filename), output = path.join(staging, ...file.name.split('/'))
      await fs.mkdir(path.dirname(output), { recursive: true }); await fs.copyFile(file.filename, output, fs.constants.COPYFILE_EXCL)
      const copied = await fileHash(output), after = await fileHash(file.filename)
      ensure(before.sha256 === copied.sha256 && before.sha256 === after.sha256, 'La fuente cambió durante el empaquetado; vuelve a compilar y repite.')
    }
    await fs.mkdir(path.join(staging, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(staging, 'scripts/start-release.mjs'), startScript, { flag: 'wx' })
    await fs.copyFile(fileURLToPath(new URL('./verify-release.mjs', import.meta.url)), path.join(staging, 'scripts/verify-release.mjs'), fs.constants.COPYFILE_EXCL)
    await fs.writeFile(path.join(staging, 'package.json'), `${JSON.stringify(deploymentPackage, null, 2)}\n`, { flag: 'wx' })
    await fs.writeFile(path.join(staging, '.npmrc'), 'registry=https://registry.npmjs.org/\n', { flag: 'wx' })
    // A native, dependency-free npm lock selects npm on a fresh import. Do not
    // copy the development pnpm lock or the host's previously generated lock.
    const npmLock = { name: deploymentPackage.name, version: deploymentPackage.version, lockfileVersion: 3, requires: true, packages: { '': { name: deploymentPackage.name, version: deploymentPackage.version, engines: deploymentPackage.engines } } }
    await fs.writeFile(path.join(staging, 'package-lock.json'), `${JSON.stringify(npmLock, null, 2)}\n`, { flag: 'wx' })
    const names = [...sourceFiles.map(file => file.name), 'scripts/start-release.mjs', 'scripts/verify-release.mjs', 'package.json', '.npmrc'].sort()
    const deliveryNames = [...names, 'package-lock.json']
    const files = []
    for (const name of names) files.push({ path: name, ...await fileHash(path.join(staging, ...name.split('/'))) })
    const manifest = { format: 'elmorenaje-release', version: 1, createdAt: new Date().toISOString(), files }
    await fs.writeFile(path.join(staging, RELEASE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await verifyRelease(staging, { ownerToken: token })
    // mkdir is exclusive: a new directory appearing after the initial check is
    // not replaced. Only this execution's reserved output may be rolled back.
    await fs.mkdir(target, { mode: 0o700 }); reserved = true
    await fs.writeFile(path.join(target, '.release-owner'), token, { flag: 'wx', mode: 0o600 })
    for (const name of [...deliveryNames, RELEASE_MANIFEST]) {
      const output = path.join(target, ...name.split('/'))
      await fs.mkdir(path.dirname(output), { recursive: true }); await fs.copyFile(path.join(staging, ...name.split('/')), output, fs.constants.COPYFILE_EXCL)
    }
    await verifyRelease(target, { ownerToken: token })
    await fs.unlink(path.join(target, '.release-owner'))
    complete = true
    return { destination: target, manifest, fileCount: names.length }
  } finally {
    if (reserved && !complete) await cleanupOwned(target, parent, token)
    await cleanupOwned(staging, parent, token)
  }
}

export function parseReleaseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help') { ensure(argv.length === 1, 'No combines --help con otros argumentos.'); return { help: true } }
    ensure(['--destination', '--project'].includes(arg), 'Argumento no admitido. Usa --help.')
    const key = arg.slice(2)
    ensure(!Object.hasOwn(options, key), 'No repitas argumentos.')
    const value = argv[++index]
    ensure(value && !value.startsWith('--'), `Falta la ruta para ${arg}.`)
    options[key] = value
  }
  ensure(options.destination, 'Falta --destination: no hay destino implícito.')
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReleaseArguments(process.argv.slice(2))
    if (options.help) console.log('Uso: node scripts/package-release.mjs --destination "DIRECTORIO_NUEVO" [--project "RAIZ_PROYECTO"]\nEl directorio padre debe existir. Requiere dist compilado; no instala, comprime ni despliega.')
    else { const result = await packageRelease(options); console.log(`Paquete local verificado: ${result.destination}\nArchivos: ${result.fileCount}. No contiene .env, bases de datos, fotografías subidas ni dependencias de desarrollo.`) }
  } catch (error) { console.error(`No se preparó el paquete: ${error.message}`); process.exitCode = 1 }
}
