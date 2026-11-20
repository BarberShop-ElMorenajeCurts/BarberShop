import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../../server/store.mjs'
import { createBackup, parseArguments, verifyBackup } from '../backup.mjs'
import { restoreBackup } from '../restore.mjs'
import photography from '../../config/photography.public.json' with { type: 'json' }

const PHOTO_NAME = '11111111-1111-4111-8111-111111111111.png'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function fixture(t, { keepOpen = false } = {}) {
  const temporaryRoot = path.resolve(os.tmpdir())
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'elmorenaje-backup-test-'))
  let store
  t.after(async () => {
    store?.close()
    const relative = path.relative(temporaryRoot, root)
    assert.ok(relative.startsWith('elmorenaje-backup-test-') && !relative.includes(path.sep) && path.dirname(root) === temporaryRoot)
    const stat = await fs.lstat(root)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink())
    await fs.rm(root, { recursive: true, force: true })
  })
  const source = path.join(root, 'original-live')
  store = new Store(source, { demo: true })
  const booking = {
    id: randomUUID(), idempotencyKey: 'fixture-booking', inputHash: 'fixture-hash',
    barberId: 'fixture-barber', serviceId: 'fixture-service',
    startAt: '2027-01-04T13:00:00.000Z', endAt: '2027-01-04T13:45:00.000Z',
    status: 'confirmed', customer: { name: 'Cliente de prueba', email: 'fixture@example.invalid', phone: '+59990000000' },
    language: 'es', syncStatus: 'synced', version: 1,
  }
  store.saveBooking(booking)
  const photo = { id: PHOTO_NAME.slice(0, -4), url: `/media/${PHOTO_NAME}`, section: 'gallery', alt: { es: 'Foto de prueba', en: 'Test photo' }, sortOrder: 0 }
  store.put('photos', photo)
  await fs.mkdir(path.join(source, 'media'))
  await fs.writeFile(path.join(source, 'media', PHOTO_NAME), PNG)
  await fs.writeFile(path.join(source, 'media', 'orphan.png'), PNG)
  // These values are fixture-only. Tests never read them; their filenames must
  // be absent from the output regardless of what they contain.
  await fs.writeFile(path.join(source, '.env'), 'FIXTURE_ONLY=not-a-real-secret\n')
  await fs.writeFile(path.join(source, 'encryption.key'), 'fixture-only-key')
  if (!keepOpen) { store.close(); store = undefined }
  return { root, source, booking, photo }
}

async function fingerprint(directory) {
  const names = ['appointments.sqlite', 'appointments.sqlite-wal', 'appointments.sqlite-shm', `media/${PHOTO_NAME}`]
  const result = {}
  for (const name of names) {
    try {
      const content = await fs.readFile(path.join(directory, ...name.split('/')))
      const stat = await fs.stat(path.join(directory, ...name.split('/')))
      result[name] = { size: stat.size, modified: stat.mtimeMs, hash: createHash('sha256').update(content).digest('hex') }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return result
}

async function notExists(target) {
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' })
}

test('backup and restore preserve bookings, catalog and referenced images without touching source', async (t) => {
  const f = await fixture(t)
  const before = await fingerprint(f.source)
  const destination = path.join(f.root, 'backup-new')
  const result = await createBackup({ source: f.source, destination, offline: true })
  assert.equal(result.manifest.counts.bookings, 1)
  assert.equal(result.manifest.counts.photos, 1)
  assert.equal(result.manifest.files.length, 2)
  assert.deepEqual(await fingerprint(f.source), before)
  assert.deepEqual(await fs.readdir(destination), ['appointments.sqlite', 'manifest.json', 'media'])
  assert.deepEqual(await fs.readdir(path.join(destination, 'media')), [PHOTO_NAME])
  await notExists(path.join(destination, '.env'))
  await notExists(path.join(destination, 'encryption.key'))
  await notExists(path.join(destination, 'appointments.sqlite-wal'))
  const backupBefore = await fingerprint(destination)
  const restored = path.join(f.root, 'restored-live')
  await restoreBackup({ source: destination, destination: restored, offline: true })
  assert.deepEqual(await fingerprint(destination), backupBefore)
  assert.deepEqual(await fingerprint(f.source), before)
  assert.deepEqual(await fs.readFile(path.join(restored, 'media', PHOTO_NAME)), PNG)
  const db = new DatabaseSync(path.join(restored, 'appointments.sqlite'), { readOnly: true })
  try {
    assert.deepEqual(JSON.parse(db.prepare('SELECT body FROM bookings WHERE id=?').get(f.booking.id).body), f.booking)
    assert.deepEqual(JSON.parse(db.prepare('SELECT body FROM photos WHERE id=?').get(f.photo.id).body), f.photo)
    const catalog = JSON.parse(db.prepare("SELECT value FROM kv WHERE key='catalog'").get().value)
    assert.ok(catalog.services.length > 0 && catalog.barbers.length > 0)
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok')
  } finally { db.close() }
  await verifyBackup(restored)
})

test('mixed uploaded and bundled photographs retain references without pretending static files are backed up', async (t) => {
  const f = await fixture(t)
  const bundled = photography.find(photo => /^\/assets\/photos\/img-\d{4}\.jpg$/.test(photo.url))
  assert.ok(bundled, 'El paquete debe declarar al menos una fotografía estática para esta prueba.')
  const staticRows = ['hero', 'gallery'].map((section, index) => ({ ...bundled, id: `bundled-fixture-${index}`, section }))
  const original = new DatabaseSync(path.join(f.source, 'appointments.sqlite'))
  try {
    const insert = original.prepare('INSERT INTO photos(id,body) VALUES(?,?)')
    for (const photo of staticRows) insert.run(photo.id, JSON.stringify(photo))
  } finally { original.close() }
  const before = await fingerprint(f.source)
  const backup = path.join(f.root, 'mixed-backup')
  const { manifest } = await createBackup({ source: f.source, destination: backup, offline: true })
  assert.equal(manifest.counts.photos, 3)
  assert.deepEqual(manifest.bundledPhotos, [bundled.url])
  assert.equal(manifest.files.length, 2)
  assert.deepEqual(manifest.files.map(entry => entry.path).sort(), ['appointments.sqlite', `media/${PHOTO_NAME}`])
  await notExists(path.join(backup, 'assets'))
  assert.deepEqual(await fingerprint(f.source), before)
  const restored = path.join(f.root, 'mixed-restored')
  const result = await restoreBackup({ source: backup, destination: restored, offline: true })
  assert.deepEqual(result.manifest.bundledPhotos, [bundled.url])
  const db = new DatabaseSync(path.join(restored, 'appointments.sqlite'), { readOnly: true })
  try {
    for (const photo of staticRows) assert.deepEqual(JSON.parse(db.prepare('SELECT body FROM photos WHERE id=?').get(photo.id).body), photo)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM photos').get().count, 3)
  } finally { db.close() }
  await notExists(path.join(restored, 'assets'))
  assert.deepEqual(await fs.readFile(path.join(restored, 'media', PHOTO_NAME)), PNG)
  await verifyBackup(restored)
  const filename = path.join(backup, 'manifest.json')
  const missingDependency = { ...manifest }
  delete missingDependency.bundledPhotos
  await fs.writeFile(filename, JSON.stringify(missingDependency))
  await assert.rejects(verifyBackup(backup), /dependencias de fotografías estáticas no coinciden/)
  await assert.rejects(restoreBackup({ source: backup, destination: path.join(f.root, 'missing-bundle-refused'), offline: true }), /dependencias de fotografías estáticas no coinciden/)
  await notExists(path.join(f.root, 'missing-bundle-refused'))
})

test('static references outside the package allowlist fail without reading or copying their paths', async (t) => {
  const f = await fixture(t)
  const allowed = new Set(photography.map(photo => photo.url))
  let unknown
  for (let index = 0; index < 10000; index++) {
    const candidate = `/assets/photos/img-${String(index).padStart(4, '0')}.jpg`
    if (!allowed.has(candidate)) { unknown = candidate; break }
  }
  assert.ok(unknown)
  const db = new DatabaseSync(path.join(f.source, 'appointments.sqlite'))
  try { db.prepare('INSERT INTO photos(id,body) VALUES(?,?)').run('unknown-static', JSON.stringify({ ...f.photo, id: 'unknown-static', url: unknown })) } finally { db.close() }
  const before = await fingerprint(f.source)
  const destination = path.join(f.root, 'unknown-static-refused')
  await assert.rejects(createBackup({ source: f.source, destination, offline: true }), /no está declarada en config\/photography.public.json/)
  await notExists(destination)
  assert.deepEqual(await fingerprint(f.source), before)
})

test('old uploaded-only backups remain verifiable without bundledPhotos while unsafe bundle metadata is rejected', async (t) => {
  const f = await fixture(t)
  const backup = path.join(f.root, 'legacy-backup')
  const { manifest } = await createBackup({ source: f.source, destination: backup, offline: true })
  const filename = path.join(backup, 'manifest.json')
  delete manifest.bundledPhotos
  await fs.writeFile(filename, JSON.stringify(manifest))
  await verifyBackup(backup)
  await restoreBackup({ source: backup, destination: path.join(f.root, 'legacy-restored'), offline: true })
  manifest.bundledPhotos = ['/assets/photos/../../outside.jpg']
  await fs.writeFile(filename, JSON.stringify(manifest))
  await assert.rejects(verifyBackup(backup), /dependencia de fotografía estática no permitida/)
})

test('WAL is recovered only in the copy; source files stay byte-identical', async (t) => {
  const f = await fixture(t, { keepOpen: true })
  const before = await fingerprint(f.source)
  assert.ok(before['appointments.sqlite-wal']?.size > 0)
  const destination = path.join(f.root, 'wal-backup')
  await createBackup({ source: f.source, destination, offline: true })
  assert.deepEqual(await fingerprint(f.source), before)
  const db = new DatabaseSync(path.join(destination, 'appointments.sqlite'), { readOnly: true })
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 1) } finally { db.close() }
  await notExists(path.join(destination, 'appointments.sqlite-wal'))
  await notExists(path.join(destination, 'appointments.sqlite-shm'))
})

test('operations require explicit offline acknowledgement and never overwrite destinations', async (t) => {
  const f = await fixture(t)
  const before = await fingerprint(f.source)
  const destination = path.join(f.root, 'existing')
  await fs.mkdir(destination)
  await assert.rejects(createBackup({ source: f.source, destination, offline: true }), /ya existe/)
  await assert.rejects(createBackup({ source: f.source, destination: path.join(f.root, 'no-ack') }), /offline/)
  await assert.rejects(createBackup({ source: f.source, destination: path.join(f.source, 'nested'), offline: true }), /independientes/)
  await assert.rejects(createBackup({ source: f.source, destination: f.source, offline: true }), /independientes/)
  await assert.rejects(createBackup({ source: f.source, destination: f.root, offline: true }), /independientes/)
  assert.deepEqual(await fs.readdir(destination), [])
  assert.deepEqual(await fingerprint(f.source), before)
  await notExists(path.join(f.root, 'no-ack'))
  await notExists(path.join(f.source, 'nested'))
})

test('missing referenced photo fails without publishing a partial backup', async (t) => {
  const f = await fixture(t)
  await fs.unlink(path.join(f.source, 'media', PHOTO_NAME))
  const before = await fingerprint(f.source)
  const destination = path.join(f.root, 'missing-photo')
  await assert.rejects(createBackup({ source: f.source, destination, offline: true }), /ENOENT/)
  await notExists(destination)
  assert.deepEqual(await fingerprint(f.source), before)
  assert.ok(!(await fs.readdir(f.root)).some((name) => name.startsWith('.missing-photo.')))
})

test('restore rejects existing destinations and corrupted image hashes before creating output', async (t) => {
  const f = await fixture(t)
  const backup = path.join(f.root, 'backup')
  await createBackup({ source: f.source, destination: backup, offline: true })
  const occupied = path.join(f.root, 'occupied')
  await fs.mkdir(occupied)
  await assert.rejects(restoreBackup({ source: backup, destination: occupied, offline: true }), /ya existe/)
  await fs.appendFile(path.join(backup, 'media', PHOTO_NAME), 'corrupted')
  await assert.rejects(verifyBackup(backup), /SHA-256/)
  const destination = path.join(f.root, 'must-not-exist')
  await assert.rejects(restoreBackup({ source: backup, destination, offline: true }), /SHA-256/)
  await notExists(destination)
  assert.deepEqual(await fs.readdir(occupied), [])
})

test('SQLite header is checked even when a hash is recomputed', async (t) => {
  const f = await fixture(t)
  const backup = path.join(f.root, 'backup')
  await createBackup({ source: f.source, destination: backup, offline: true })
  const filename = path.join(backup, 'appointments.sqlite')
  const data = await fs.readFile(filename)
  data[0] = 0
  await fs.writeFile(filename, data)
  const manifestFile = path.join(backup, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  const entry = manifest.files.find((file) => file.path === 'appointments.sqlite')
  entry.sha256 = createHash('sha256').update(data).digest('hex')
  await fs.writeFile(manifestFile, JSON.stringify(manifest))
  await assert.rejects(verifyBackup(backup), /cabecera SQLite/)
})

test('standalone verification rejects WAL-mode archives before creating sidecars', async (t) => {
  const f = await fixture(t)
  const backup = path.join(f.root, 'wal-header')
  await createBackup({ source: f.source, destination: backup, offline: true })
  const filename = path.join(backup, 'appointments.sqlite')
  const data = await fs.readFile(filename)
  data[18] = 2
  data[19] = 2
  await fs.writeFile(filename, data)
  const manifestFile = path.join(backup, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  manifest.files.find(file => file.path === 'appointments.sqlite').sha256 = createHash('sha256').update(data).digest('hex')
  await fs.writeFile(manifestFile, JSON.stringify(manifest))
  const before = await fingerprint(backup)
  await assert.rejects(verifyBackup(backup), /sin modo WAL pendiente/)
  await assert.rejects(restoreBackup({ source: backup, destination: path.join(f.root, 'refused-wal'), offline: true }), /sin modo WAL pendiente/)
  assert.deepEqual(await fingerprint(backup), before)
  await notExists(path.join(backup, 'appointments.sqlite-wal'))
  await notExists(path.join(backup, 'appointments.sqlite-shm'))
  await notExists(path.join(f.root, 'refused-wal'))
})

test('a valid SQLite file with an incomplete application schema cannot be restored', async (t) => {
  const f = await fixture(t)
  const backup = path.join(f.root, 'bad-schema')
  await createBackup({ source: f.source, destination: backup, offline: true })
  const filename = path.join(backup, 'appointments.sqlite')
  const db = new DatabaseSync(filename)
  try { db.exec('DROP TABLE jobs'); assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok') } finally { db.close() }
  const data = await fs.readFile(filename)
  const manifestFile = path.join(backup, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  const entry = manifest.files.find(file => file.path === 'appointments.sqlite')
  entry.sha256 = createHash('sha256').update(data).digest('hex')
  entry.size = data.length
  await fs.writeFile(manifestFile, JSON.stringify(manifest))
  const before = await fingerprint(backup)
  await assert.rejects(restoreBackup({ source: backup, destination: path.join(f.root, 'refused-schema'), offline: true }), /esquema de ElMorenaje Cuts/)
  assert.deepEqual(await fingerprint(backup), before)
  await notExists(path.join(f.root, 'refused-schema'))
})

test('portable paths reject Windows aliases that could conceal a destination inside the source', async (t) => {
  const f = await fixture(t)
  const before = await fingerprint(f.source)
  for (const alias of [`${f.source}.`, `${f.source} `]) {
    await assert.rejects(createBackup({ source: f.source, destination: path.join(alias, 'nested'), offline: true }), /nombres ambiguos/)
  }
  assert.deepEqual(await fingerprint(f.source), before)
  await notExists(path.join(f.source, 'nested'))
})

test('manifest paths and unlisted files cannot introduce secrets or traversal into restore', async (t) => {
  const f = await fixture(t)
  const backup = path.join(f.root, 'backup')
  await createBackup({ source: f.source, destination: backup, offline: true })
  const manifestFile = path.join(backup, 'manifest.json')
  const original = await fs.readFile(manifestFile, 'utf8')
  const manifest = JSON.parse(original)
  manifest.files.push({ path: '../outside', size: 1, sha256: '0'.repeat(64) })
  await fs.writeFile(manifestFile, JSON.stringify(manifest))
  await assert.rejects(verifyBackup(backup), /ruta no permitida/)
  await fs.writeFile(manifestFile, original)
  await fs.writeFile(path.join(backup, 'unlisted-secret.key'), 'fixture')
  await assert.rejects(verifyBackup(backup), /no declarada/)
  const destination = path.join(f.root, 'restore-refused')
  await assert.rejects(restoreBackup({ source: backup, destination, offline: true }), /no declarada/)
  await notExists(destination)
})

test('sources and ancestors containing symbolic links or junctions are rejected', async (t) => {
  const f = await fixture(t)
  const linked = path.join(f.root, 'source-link')
  try { await fs.symlink(f.source, linked, 'junction') }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('El sistema no permite crear enlaces para la prueba.'); return }; throw error }
  await assert.rejects(createBackup({ source: linked, destination: path.join(f.root, 'unsafe'), offline: true }), /enlaces simbólicos|uniones/)
  const insideLink = path.join(f.source, 'linked-folder')
  const external = path.join(f.root, 'external')
  await fs.mkdir(external)
  await fs.symlink(external, insideLink, 'junction')
  await assert.rejects(createBackup({ source: f.source, destination: path.join(f.root, 'unsafe-tree'), offline: true }), /enlace simbólico|unión/)
  await notExists(path.join(f.root, 'unsafe'))
  await notExists(path.join(f.root, 'unsafe-tree'))
  await fs.unlink(insideLink)
  await fs.unlink(linked)
})

test('literal CLI arguments reject omission, duplicates and implicit destinations', () => {
  assert.deepEqual(parseArguments(['--source', 'source', '--destination', 'destination', '--offline']), { source: 'source', destination: 'destination', offline: true })
  assert.throws(() => parseArguments(['--source', 'source']), /--destination/)
  assert.throws(() => parseArguments(['--source', 'a', '--source', 'b', '--destination', 'c']), /No repitas/)
  assert.throws(() => parseArguments(['--source', '--destination', 'b']), /Falta la ruta/)
  assert.throws(() => parseArguments(['--source', 'a', '--destination', 'b', '--force']), /no admitido/)
})
