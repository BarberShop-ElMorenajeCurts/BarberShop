import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELEASE_MANIFEST = 'release-manifest.json'
const staticExtensions = new Set(['.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico', '.txt', '.woff', '.woff2', '.ttf', '.eot'])
const generatedFiles = new Set(['package-lock.json'])
function ensure(value, message) { if (!value) throw new Error(message) }

export function allowedReleaseFile(value) {
  if (value === '.npmrc') return true
  if (typeof value !== 'string' || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return false
  if (['package.json', 'config/business.public.json', 'config/photography.public.json', 'scripts/start-release.mjs', 'scripts/verify-release.mjs'].includes(value)) return true
  if (/^server\/[a-z][a-z0-9-]*\.mjs$/.test(value) && !value.endsWith('.test.mjs')) return true
  return value.startsWith('dist/') && staticExtensions.has(path.posix.extname(value).toLowerCase()) && !/(?:^|\/)(?:node_modules|secrets?|credentials?)(?:\/|\.)/i.test(value)
}

export async function fileHash(filename) {
  const before = await fs.lstat(filename)
  ensure(before.isFile() && !before.isSymbolicLink(), 'El paquete contiene un archivo no regular o enlazado.')
  const bytes = await fs.readFile(filename)
  const after = await fs.lstat(filename)
  ensure(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'Un archivo cambió durante la verificación.')
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function validatePhotographyManifest(photography, files) {
  ensure(Array.isArray(photography) && photography.length <= 1000, 'El manifiesto público de fotografías debe ser un arreglo.')
  const ids = new Set()
  for (const photo of photography) {
    ensure(photo && typeof photo.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(photo.id) && !ids.has(photo.id) && ['hero', 'gallery', 'barbers'].includes(photo.section) && typeof photo.url === 'string' && /^\/assets\/photos\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/.test(photo.url) && typeof photo.alt?.es === 'string' && typeof photo.alt?.en === 'string' && Number.isInteger(photo.sortOrder), 'Entrada de fotografía pública no válida.')
    ids.add(photo.id)
    ensure(files.has(`dist${photo.url}`), 'Falta una fotografía declarada en dist/assets/photos.')
  }
}

async function assertNoLinkedPath(directory) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const info = await fs.lstat(current)
    ensure(info.isDirectory() && !info.isSymbolicLink(), 'El directorio del paquete contiene enlaces o uniones no admitidos.')
  }
  return absolute
}

async function collect(directory, { runtime = false, ownerToken = null } = {}, prefix = '') {
  const result = []
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const info = await fs.lstat(path.join(directory, ...relative.split('/')))
    ensure(!info.isSymbolicLink(), 'El paquete contiene enlaces simbólicos o uniones.')
    if (entry.name === '.git') {
      // A normal Git checkout adds root metadata that is not application
      // content. Never inspect it or follow a worktree's gitdir pointer file.
      ensure(!prefix && info.isDirectory(), 'Solo se admite .git como directorio real en la raíz del paquete; archivos de worktree y metadatos anidados no se admiten.')
      continue
    }
    if (!prefix && entry.name === '.airo') {
      // GoDaddy adds this deployment metadata after importing the source.
      // It is not application code. Permit only its observed configuration
      // file, without reading values or allowing links or arbitrary content.
      ensure(info.isDirectory(), '.airo debe ser un directorio real.')
      const metadata = await fs.readdir(path.join(directory, '.airo'))
      ensure(metadata.length === 1 && metadata[0] === 'config.json', 'Metadatos .airo no admitidos: solo se permite config.json.')
      const config = await fs.lstat(path.join(directory, '.airo/config.json'))
      ensure(config.isFile() && !config.isSymbolicLink() && config.size <= 65536, 'La configuración .airo debe ser un archivo regular de hasta 64 KiB.')
      continue
    }
    if (!prefix && ownerToken && entry.name === '.release-owner') { ensure(info.isFile() && await fs.readFile(path.join(directory, entry.name), 'utf8') === ownerToken, 'Marca de salida no válida.'); continue }
    if (!prefix && entry.name === 'node_modules') { ensure(info.isDirectory(), 'node_modules debe ser un directorio.'); continue }
    if (!prefix && runtime && entry.name === '.data') { ensure(info.isDirectory(), 'El almacenamiento local debe ser un directorio.'); continue }
    if (info.isDirectory()) {
      ensure(!entry.name.startsWith('.') && (['dist', 'server', 'scripts', 'config'].includes(relative) || relative.startsWith('dist/')), `Directorio no admitido en el paquete: ${relative}`)
      result.push(...await collect(directory, { runtime, ownerToken }, relative))
    } else {
      ensure(info.isFile(), 'El paquete contiene un archivo especial no admitido.')
      result.push(relative)
    }
  }
  return result.sort()
}

export async function verifyRelease(directory, { runtime = false, ownerToken = null } = {}) {
  const absolute = await assertNoLinkedPath(directory)
  const manifestPath = path.join(absolute, RELEASE_MANIFEST)
  const manifestInfo = await fs.lstat(manifestPath)
  ensure(manifestInfo.isFile() && !manifestInfo.isSymbolicLink() && manifestInfo.size < 2 * 1024 * 1024, 'Manifiesto no válido.')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  ensure(manifest?.format === 'elmorenaje-release' && manifest.version === 1 && Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 10000, 'Formato de manifiesto no admitido.')
  const files = new Map()
  for (const file of manifest.files) {
    ensure(file && allowedReleaseFile(file.path) && !files.has(file.path) && Number.isSafeInteger(file.size) && file.size >= 0 && /^[a-f0-9]{64}$/.test(file.sha256), 'Entrada insegura o duplicada en el manifiesto.')
    files.set(file.path, file)
  }
  for (const required of ['package.json', 'dist/index.html', 'server/index.mjs', 'server/http.mjs', 'server/config.mjs', 'config/business.public.json', 'config/photography.public.json', 'scripts/start-release.mjs', 'scripts/verify-release.mjs']) ensure(files.has(required), `Falta un archivo requerido: ${required}`)
  const actual = await collect(absolute, { runtime, ownerToken })
  for (const relative of actual) ensure(relative === RELEASE_MANIFEST || files.has(relative) || generatedFiles.has(relative), `Archivo no declarado en el paquete: ${relative}`)
  for (const [relative, expected] of files) {
    const current = await fileHash(path.join(absolute, ...relative.split('/')))
    ensure(current.size === expected.size && current.sha256 === expected.sha256, `SHA-256 no coincide: ${relative}`)
  }
  const pkg = JSON.parse(await fs.readFile(path.join(absolute, 'package.json'), 'utf8'))
  const business = JSON.parse(await fs.readFile(path.join(absolute, 'config/business.public.json'), 'utf8'))
  ensure(business && typeof business === 'object' && !Array.isArray(business), 'La configuración comercial pública no es un objeto JSON.')
  validatePhotographyManifest(JSON.parse(await fs.readFile(path.join(absolute, 'config/photography.public.json'), 'utf8')), files)
  ensure(pkg.type === 'module' && typeof pkg.name === 'string' && pkg.name.length > 0 && typeof pkg.version === 'string' && pkg.version.length > 0, 'package.json no identifica una aplicación ESM válida.')
  ensure(pkg.main === 'server/index.mjs' && pkg.engines?.node === '>=22.13.0', 'Versión o punto de entrada del paquete no admitidos.')
  ensure(pkg.scripts?.build === 'node scripts/verify-release.mjs' && pkg.scripts?.start === 'node scripts/start-release.mjs', 'Los scripts de compilación/arranque no corresponden al perfil verificado.')
  ensure(Object.keys(pkg.dependencies || {}).length === 0 && Object.keys(pkg.devDependencies || {}).length === 0 && Object.keys(pkg.scripts).every(key => ['build', 'start'].includes(key)), 'Este perfil no admite dependencias externas ni scripts adicionales.')
  return { directory: absolute, manifest, fileCount: files.size }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    ensure(process.argv.length === 2, 'Ejecuta el verificador sin argumentos desde la raíz del paquete.')
    const result = await verifyRelease(process.cwd())
    console.log(`Paquete precompilado íntegro: ${result.fileCount} archivos. No comprueba alojamiento, persistencia ni conexión Google.`)
  } catch (error) { console.error(`Paquete no válido: ${error.message}`); process.exitCode = 1 }
}
