import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { packageRelease, parseReleaseArguments } from '../package-release.mjs'
import { verifyRelease, RELEASE_MANIFEST } from '../verify-release.mjs'

async function fixture(t) {
  const temporary = path.resolve(os.tmpdir()), root = await fs.mkdtemp(path.join(temporary, 'elmorenaje-release-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), temporary)
    assert.ok(path.basename(root).startsWith('elmorenaje-release-test-'))
    const info = await fs.lstat(root)
    assert.ok(info.isDirectory() && !info.isSymbolicLink())
    await fs.rm(root, { recursive: true, force: true })
  })
  const project = path.join(root, 'project')
  for (const dir of ['dist/assets/photos', 'server', 'scripts', 'config', '.release', '.data/live', 'node_modules', 'docs']) await fs.mkdir(path.join(project, ...dir.split('/')), { recursive: true })
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'release-fixture', version: '1.2.3', type: 'module', devDependencies: { vite: 'fixture-only' } }))
  await fs.writeFile(path.join(project, 'dist/index.html'), '<html><script type="module" src="/assets/app.js"></script></html>')
  await fs.writeFile(path.join(project, 'dist/assets/app.js'), 'console.log("fixture")')
  await fs.writeFile(path.join(project, 'dist/assets/photos/owned-fixture.jpg'), 'PUBLIC_PHOTO_FIXTURE')
  await fs.writeFile(path.join(project, 'dist/robots.txt'), 'User-agent: *\nDisallow: /\n')
  await fs.writeFile(path.join(project, 'server/index.mjs'), "import { setup } from './http.mjs'\nexport const startServer = setup\n")
  await fs.writeFile(path.join(project, 'server/http.mjs'), "import path from 'node:path'\nexport const setup = () => ({ close: async () => {}, path })\n")
  await fs.writeFile(path.join(project, 'server/config.mjs'), "import business from '../config/business.public.json' with { type: 'json' }\nexport const mode = business.mode\n")
  await fs.writeFile(path.join(project, 'config/business.public.json'), '{"name":"Negocio de prueba"}')
  await fs.writeFile(path.join(project, 'config/photography.public.json'), JSON.stringify([{ id: 'owned-fixture', section: 'gallery', url: '/assets/photos/owned-fixture.jpg', alt: { es: 'Foto de prueba', en: 'Test photo' }, sortOrder: 1 }]))
  await fs.writeFile(path.join(project, 'server/excluded.test.mjs'), 'throw new Error("never included")')
  for (const relative of ['.env', '.data/live/appointments.sqlite', 'node_modules/private.txt', 'docs/private.txt']) await fs.writeFile(path.join(project, ...relative.split('/')), 'FIXTURE_ONLY_NEVER_PACKAGE')
  return { root, project, destination: path.join(project, '.release/bundle') }
}

async function readTree(directory, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await readTree(directory, relative))
    else files.push(relative)
  }
  return files.sort()
}

test('precompiled release includes only public build, native server and independent build/start profile', async t => {
  const f = await fixture(t)
  const before = await fs.readFile(path.join(f.project, 'package.json'), 'utf8')
  const result = await packageRelease(f)
  assert.equal(result.destination, f.destination)
  const verified = await verifyRelease(f.destination)
  assert.equal(verified.fileCount, result.fileCount)
  assert.deepEqual(await readTree(f.destination), [
    'config/business.public.json', 'config/photography.public.json', 'dist/assets/app.js', 'dist/assets/photos/owned-fixture.jpg', 'dist/index.html', 'dist/robots.txt', 'package.json', RELEASE_MANIFEST,
    'scripts/start-release.mjs', 'scripts/verify-release.mjs', 'server/config.mjs', 'server/http.mjs', 'server/index.mjs',
  ].sort())
  const pkg = JSON.parse(await fs.readFile(path.join(f.destination, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dependencies, {})
  assert.equal(pkg.devDependencies, undefined)
  assert.equal(pkg.main, 'server/index.mjs')
  assert.equal(pkg.scripts.start, 'node scripts/start-release.mjs')
  assert.equal(pkg.scripts.build, 'node scripts/verify-release.mjs')
  const start = await fs.readFile(path.join(f.destination, 'scripts/start-release.mjs'), 'utf8')
  assert.match(start, /HOST \|\|= '0\.0\.0\.0'/)
  assert.match(start, /APP_MODE \|\|= 'setup'/)
  assert.equal(await fs.readFile(path.join(f.project, 'package.json'), 'utf8'), before)
  const cli = spawnSync(process.execPath, ['scripts/verify-release.mjs'], { cwd: f.destination, encoding: 'utf8', timeout: 10000 })
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /Paquete precompilado íntegro/)
  assert.ok(!cli.stdout.includes('FIXTURE_ONLY'))
})

test('generated npm files and local runtime data do not break a legitimate restart profile', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  await fs.writeFile(path.join(f.destination, 'package-lock.json'), '{}')
  await fs.mkdir(path.join(f.destination, 'node_modules'))
  await verifyRelease(f.destination)
  await fs.mkdir(path.join(f.destination, '.data'))
  await assert.rejects(verifyRelease(f.destination), /Directorio no admitido/)
  await verifyRelease(f.destination, { runtime: true })
})

test('a normal Git checkout verifies without reading or inventorying root Git metadata', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = path.join(f.root, 'no-global-gitconfig')
  const initialized = spawnSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', f.destination], { cwd: f.root, env, encoding: 'utf8', timeout: 10000 })
  assert.equal(initialized.status, 0, initialized.stderr || initialized.error?.message)
  assert.ok((await fs.lstat(path.join(f.destination, '.git'))).isDirectory())
  await fs.writeFile(path.join(f.destination, '.git', 'metadata-only.fixture'), 'NOT_APPLICATION_CONTENT')
  const verified = await verifyRelease(f.destination)
  assert.ok(verified.manifest.files.every(file => !file.path.startsWith('.git/')))
  const cli = spawnSync(process.execPath, ['scripts/verify-release.mjs'], { cwd: f.destination, encoding: 'utf8', timeout: 10000 })
  assert.equal(cli.status, 0, cli.stderr)
  await fs.writeFile(path.join(f.destination, '.env'), 'FIXTURE_ONLY')
  await assert.rejects(verifyRelease(f.destination), /Archivo no declarado/)
})

test('a root .git worktree pointer file is rejected rather than read or followed', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  await fs.writeFile(path.join(f.destination, '.git'), 'gitdir: outside-not-to-be-followed\n')
  await assert.rejects(verifyRelease(f.destination), /Solo se admite \.git como directorio real/)
})

test('root .git symlinks and junctions remain forbidden', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  const outside = path.join(f.root, 'outside-metadata'), linked = path.join(f.destination, '.git')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'keep.fixture'), 'PRESERVE')
  try { await fs.symlink(outside, linked, 'junction') }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('El entorno no permite enlaces para esta comprobación.'); return }; throw error }
  try { await assert.rejects(verifyRelease(f.destination), /enlaces simbólicos o uniones/) }
  finally { await fs.unlink(linked) }
  assert.equal(await fs.readFile(path.join(outside, 'keep.fixture'), 'utf8'), 'PRESERVE')
})

test('nested Git metadata and hidden directories inside dist are rejected even when empty', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  for (const relative of ['dist/.git', 'server/.git', 'config/.git']) {
    const filename = path.join(f.destination, ...relative.split('/'))
    await fs.mkdir(filename)
    await assert.rejects(verifyRelease(f.destination), /metadatos anidados/)
    await fs.rmdir(filename)
  }
  await fs.mkdir(path.join(f.destination, 'dist/.env'))
  await assert.rejects(verifyRelease(f.destination), /Directorio no admitido/)
})

test('release refuses missing or unsafe declared photographs and an absent photography manifest', async t => {
  const f = await fixture(t), photoManifest = path.join(f.project, 'config/photography.public.json')
  const original = await fs.readFile(photoManifest, 'utf8'), photos = JSON.parse(original)
  photos[0].url = '/assets/photos/absent.jpg'
  await fs.writeFile(photoManifest, JSON.stringify(photos))
  await assert.rejects(packageRelease(f), /Falta una fotografía declarada/)
  photos[0].url = '/assets/photos/../../private.jpg'
  await fs.writeFile(photoManifest, JSON.stringify(photos))
  await assert.rejects(packageRelease(f), /fotografía pública no válida/)
  await fs.unlink(photoManifest)
  await assert.rejects(packageRelease(f), { code: 'ENOENT' })
  await fs.writeFile(photoManifest, original)
  await packageRelease(f)
  const releaseManifestPath = path.join(f.destination, RELEASE_MANIFEST), releaseManifest = JSON.parse(await fs.readFile(releaseManifestPath, 'utf8'))
  releaseManifest.files = releaseManifest.files.filter(file => file.path !== 'config/photography.public.json')
  await fs.writeFile(releaseManifestPath, JSON.stringify(releaseManifest))
  await assert.rejects(verifyRelease(f.destination), /Falta un archivo requerido/)
})

test('changes to declared files and extra unlisted secret files are rejected', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  const app = path.join(f.destination, 'dist/assets/app.js'), original = await fs.readFile(app)
  await fs.appendFile(app, 'changed')
  await assert.rejects(verifyRelease(f.destination), /SHA-256/)
  await fs.writeFile(app, original)
  await fs.writeFile(path.join(f.destination, '.env'), 'FIXTURE_ONLY')
  await assert.rejects(verifyRelease(f.destination), /Archivo no declarado/)
})

test('manifest traversal cannot read or include an outside file', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  const filename = path.join(f.destination, RELEASE_MANIFEST), manifest = JSON.parse(await fs.readFile(filename, 'utf8'))
  manifest.files.push({ path: '../../.env', size: 1, sha256: '0'.repeat(64) })
  await fs.writeFile(filename, JSON.stringify(manifest))
  await assert.rejects(verifyRelease(f.destination), /Entrada insegura/)
})

test('existing destinations, sources and ancestors are refused without changing their contents', async t => {
  const f = await fixture(t)
  await fs.mkdir(f.destination)
  await fs.writeFile(path.join(f.destination, 'keep.txt'), 'preserve')
  await assert.rejects(packageRelease(f), /ya existe/)
  for (const destination of [f.project, f.root, path.join(f.project, 'dist/inside'), path.join(f.project, 'server/inside'), path.join(f.project, 'scripts/inside'), path.join(f.project, 'config/inside')]) await assert.rejects(packageRelease({ project: f.project, destination }), /antecesores|separado/)
  assert.equal(await fs.readFile(path.join(f.destination, 'keep.txt'), 'utf8'), 'preserve')
})

test('failed staging verification removes only its own staging directory and creates no release', async t => {
  const f = await fixture(t)
  await fs.unlink(path.join(f.project, 'server/http.mjs'))
  // Keep index syntactically native but let verification identify the missing
  // required runtime file after staging has actually been created.
  await fs.writeFile(path.join(f.project, 'server/index.mjs'), 'export const startServer = () => {}')
  await assert.rejects(packageRelease(f), /Falta un archivo requerido/)
  await assert.rejects(fs.lstat(f.destination), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(path.dirname(f.destination)), [])
})

test('external server dependencies and unexpected files in public output fail closed', async t => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.project, 'server/index.mjs'), "import 'external-package'\n")
  await assert.rejects(packageRelease(f), /dependencias externas/)
  await fs.writeFile(path.join(f.project, 'server/index.mjs'), 'export const startServer = () => {}')
  await fs.writeFile(path.join(f.project, 'dist/.env'), 'FIXTURE_ONLY')
  await assert.rejects(packageRelease(f), /Archivo no admitido/)
  assert.deepEqual(await fs.readdir(path.dirname(f.destination)), [])
})

test('linked source ancestors are refused without copying external data', async t => {
  const f = await fixture(t), linked = path.join(f.root, 'linked-project')
  try { await fs.symlink(f.project, linked, 'junction') }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('El entorno no permite enlaces para esta comprobación.'); return }; throw error }
  try { await assert.rejects(packageRelease({ project: linked, destination: path.join(f.root, 'unsafe') }), /enlaces|uniones/) }
  finally { await fs.unlink(linked) }
  await assert.rejects(fs.lstat(path.join(f.root, 'unsafe')), { code: 'ENOENT' })
})

test('recomputed manifest hash does not allow an altered deployment contract', async t => {
  const f = await fixture(t)
  await packageRelease(f)
  const filename = path.join(f.destination, 'package.json'), pkg = JSON.parse(await fs.readFile(filename, 'utf8'))
  pkg.dependencies = { external: '1' }
  const bytes = Buffer.from(JSON.stringify(pkg))
  await fs.writeFile(filename, bytes)
  const mf = path.join(f.destination, RELEASE_MANIFEST), manifest = JSON.parse(await fs.readFile(mf, 'utf8'))
  const entry = manifest.files.find(file => file.path === 'package.json')
  entry.size = bytes.length; entry.sha256 = createHash('sha256').update(bytes).digest('hex')
  await fs.writeFile(mf, JSON.stringify(manifest))
  await assert.rejects(verifyRelease(f.destination), /dependencias externas/)
})

test('CLI requires a literal explicit new destination and rejects duplicate flags', () => {
  assert.deepEqual(parseReleaseArguments(['--destination', 'new-folder']), { destination: 'new-folder' })
  assert.deepEqual(parseReleaseArguments(['--help']), { help: true })
  assert.throws(() => parseReleaseArguments([]), /Falta --destination/)
  assert.throws(() => parseReleaseArguments(['--destination', '--project']), /Falta la ruta/)
  assert.throws(() => parseReleaseArguments(['--destination', 'a', '--destination', 'b']), /No repitas/)
  assert.throws(() => parseReleaseArguments(['--force']), /no admitido/)
})
