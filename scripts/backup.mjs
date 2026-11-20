import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const DATABASE = 'appointments.sqlite'
const MANIFEST = 'manifest.json'
const FORMAT = 'elmorenaje-backup'
const TABLES = ['kv', 'bookings', 'jobs', 'sessions', 'oauth', 'events', 'photos', 'blocks', 'audit']
const MEDIA_PATH = /^media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/
const BUNDLED_PHOTO_URL = /^\/assets\/photos\/img-\d{4}\.jpg$/
const PHOTOGRAPHY_MANIFEST = fileURLToPath(new URL('../config/photography.public.json', import.meta.url))

function ensure(condition, explanation) {
  if (!condition) throw new Error(explanation)
}

async function validateBundledPhotos(urls) {
  ensure(Array.isArray(urls) && urls.every(url => typeof url === 'string' && BUNDLED_PHOTO_URL.test(url)), 'El manifiesto contiene una dependencia de fotografía estática no permitida.')
  ensure(new Set(urls).size === urls.length, 'El manifiesto contiene dependencias de fotografías estáticas duplicadas.')
  if (urls.length === 0) return
  // The allowlist belongs to this code package. Neither the database nor an
  // incoming backup can choose another manifest or make us read static files.
  await noLinkedAncestors(PHOTOGRAPHY_MANIFEST)
  const stat = await regularFile(PHOTOGRAPHY_MANIFEST)
  ensure(stat.size <= 1024 * 1024, 'El manifiesto local de fotografías es demasiado grande.')
  const photography = JSON.parse(await fs.readFile(PHOTOGRAPHY_MANIFEST, 'utf8'))
  ensure(Array.isArray(photography) && photography.every(photo => photo && typeof photo.url === 'string' && BUNDLED_PHOTO_URL.test(photo.url)), 'El manifiesto local de fotografías no tiene un formato seguro.')
  const allowed = new Set(photography.map(photo => photo.url))
  ensure(urls.every(url => allowed.has(url)), 'Una fotografía estática no está declarada en config/photography.public.json; conserva el paquete correspondiente al respaldo.')
}

function normalized(input, label) {
  ensure(typeof input === 'string' && input.trim() && !/[\0<>"|?*]/.test(input), `${label}: especifica una ruta local válida.`)
  ensure(!input.split(/[\\/]/).includes('..'), `${label}: no se admiten segmentos "..".`)
  ensure(input.split(/[\\/]/).every(segment => segment === '.' || !/[. ]$/.test(segment)), `${label}: no se admiten nombres ambiguos con punto o espacio final.`)
  ensure(!/^[\\/]{2}/.test(input), `${label}: no se admiten rutas de red UNC.`)
  ensure(!input.replace(/^[A-Za-z]:/, '').includes(':'), `${label}: no se admiten flujos alternativos ni URI.`)
  const absolute = path.resolve(input)
  ensure(absolute !== path.parse(absolute).root, `${label}: no puede ser la raíz del volumen.`)
  return absolute
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function exists(target) {
  try { await fs.lstat(target); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

async function noLinkedAncestors(target) {
  const root = path.parse(target).root
  let current = root
  for (const segment of target.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current)
    ensure(!stat.isSymbolicLink(), `No se admiten enlaces simbólicos o uniones en la ruta: ${current}`)
    ensure(stat.isDirectory() || current === target, `La ruta contiene un componente que no es un directorio: ${current}`)
  }
}

async function scanTree(directory, relative = '') {
  const entries = []
  for (const item of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${item.name}` : item.name
    const stat = await fs.lstat(path.join(directory, ...child.split('/')))
    ensure(!stat.isSymbolicLink(), `La fuente contiene un enlace simbólico o unión: ${child}`)
    ensure(stat.isFile() || stat.isDirectory(), `La fuente contiene un archivo especial no admitido: ${child}`)
    entries.push({ relative: child, directory: stat.isDirectory() })
    if (stat.isDirectory()) entries.push(...await scanTree(directory, child))
  }
  return entries
}

async function regularFile(target) {
  const stat = await fs.lstat(target)
  ensure(stat.isFile() && !stat.isSymbolicLink(), `Se esperaba un archivo regular: ${target}`)
  return stat
}

async function digest(target) {
  const before = await regularFile(target)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(target)) hash.update(chunk)
  const after = await regularFile(target)
  ensure(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino, 'Un archivo cambió mientras se leía. Detén la API y vuelve a intentarlo.')
  return { size: after.size, sha256: hash.digest('hex') }
}

async function databaseHeader(target, standalone = false) {
  await regularFile(target)
  const file = await fs.open(target, 'r')
  try {
    const header = Buffer.alloc(20)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    ensure(bytesRead === 20 && header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')), 'La base no tiene una cabecera SQLite válida.')
    // A verified archive is standalone. Reject a WAL-mode archive before opening
    // SQLite so verification cannot create sidecars beside the supplied backup.
    if (standalone) ensure(header[18] === 1 && header[19] === 1, 'El respaldo SQLite debe estar consolidado, sin modo WAL pendiente.')
  } finally { await file.close() }
}

function inspectDatabase(filename) {
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;')
    const integrity = db.prepare('PRAGMA quick_check').all()
    ensure(integrity.length === 1 && integrity[0].quick_check === 'ok', 'Falló PRAGMA quick_check: la base SQLite no es íntegra.')
    ensure(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'La base contiene referencias SQLite inválidas.')
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
    ensure(TABLES.every((name) => tables.has(name)), 'La base no corresponde al esquema de ElMorenaje Cuts.')
    const catalogRow = db.prepare("SELECT value FROM kv WHERE key='catalog'").get()
    ensure(catalogRow, 'La base no contiene el catálogo del negocio.')
    const catalog = JSON.parse(catalogRow.value)
    ensure(catalog && Array.isArray(catalog.services) && Array.isArray(catalog.barbers) && catalog.settings && typeof catalog.settings === 'object', 'El catálogo no tiene una estructura válida.')
    for (const row of db.prepare('SELECT value FROM kv').all()) JSON.parse(row.value)
    for (const table of ['bookings', 'photos', 'blocks', 'events', 'sessions', 'oauth']) {
      for (const row of db.prepare(`SELECT body FROM ${table}`).all()) JSON.parse(row.body)
    }
    const photoFiles = [], bundledPhotos = new Set()
    let photoCount = 0
    for (const row of db.prepare('SELECT body FROM photos ORDER BY id').all()) {
      const photo = JSON.parse(row.body)
      photoCount++
      if (typeof photo.url === 'string' && BUNDLED_PHOTO_URL.test(photo.url)) {
        bundledPhotos.add(photo.url)
        continue
      }
      const relative = typeof photo.url === 'string' ? photo.url.replace(/^\//, '') : ''
      ensure(MEDIA_PATH.test(relative) && photo.url === `/${relative}`, 'El catálogo contiene una ruta de fotografía insegura o no admitida.')
      photoFiles.push(relative)
    }
    ensure(new Set(photoFiles).size === photoFiles.length, 'Hay fotografías duplicadas que apuntan al mismo archivo.')
    return {
      media: photoFiles.sort(),
      bundledPhotos: [...bundledPhotos].sort(),
      counts: {
        bookings: Number(db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count),
        photos: photoCount,
        services: catalog.services.length,
        barbers: catalog.barbers.length,
        jobs: Number(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count),
        blocks: Number(db.prepare('SELECT COUNT(*) AS count FROM blocks').get().count),
      },
    }
  } finally { db.close() }
}

async function imageHeader(target, relative) {
  const stat = await regularFile(target)
  ensure(stat.size <= 5 * 1024 * 1024, `La fotografía supera 5 MB: ${relative}`)
  const file = await fs.open(target, 'r')
  try {
    const header = Buffer.alloc(12)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    const extension = path.extname(relative)
    const valid = extension === '.png'
      ? bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : extension === '.jpg'
        ? bytesRead >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255
        : bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
    ensure(valid, `La cabecera de imagen no coincide con su formato: ${relative}`)
  } finally { await file.close() }
}

async function validateLocations(sourceInput, destinationInput) {
  const source = normalized(sourceInput, 'Fuente')
  const destination = normalized(destinationInput, 'Destino')
  ensure(!contained(source, destination) && !contained(destination, source), 'Fuente y destino deben ser directorios independientes; ninguno puede contener al otro.')
  await noLinkedAncestors(source)
  ensure((await fs.lstat(source)).isDirectory(), 'La fuente debe ser un directorio.')
  await noLinkedAncestors(path.dirname(destination))
  ensure((await fs.lstat(path.dirname(destination))).isDirectory(), 'El directorio padre del destino debe existir.')
  const actualSource = await fs.realpath(source)
  const actualDestination = path.join(await fs.realpath(path.dirname(destination)), path.basename(destination))
  ensure(!contained(actualSource, actualDestination) && !contained(actualDestination, actualSource), 'Fuente y destino deben ser directorios independientes después de resolver sus rutas reales.')
  ensure(!await exists(destination), 'El destino ya existe. Elige un directorio nuevo; no se sobrescribe ningún destino.')
  await scanTree(source)
  return { source, destination }
}

async function stageFor(destination, operation) {
  const parent = path.dirname(destination)
  const stage = path.join(parent, `.${path.basename(destination)}.${operation}-${randomUUID()}.tmp`)
  ensure(path.dirname(stage) === parent && contained(parent, stage), 'Directorio temporal fuera del destino previsto.')
  await fs.mkdir(stage, { mode: 0o700 })
  return stage
}

// Never recursively remove a computed directory. Only remove the exact regular
// files created by this operation, then empty directories; unknown files remain.
async function cleanup(directory, written) {
  for (const relative of [...written].reverse()) {
    const target = path.join(directory, ...relative.split('/'))
    ensure(contained(directory, target) && target !== directory, 'Limpieza fuera del directorio temporal propio.')
    try { await fs.unlink(target) } catch (error) { if (error.code !== 'ENOENT') continue }
  }
  await fs.rmdir(path.join(directory, 'media')).catch(() => undefined)
  await fs.rmdir(directory).catch(() => undefined)
}

async function exclusiveCopy(source, destination, relative, written, expected = null) {
  const segments = relative.split('/')
  ensure(relative === DATABASE || relative === MANIFEST || relative === `${DATABASE}-wal` || MEDIA_PATH.test(relative), 'Nombre de archivo de copia no permitido.')
  await fs.copyFile(path.join(source, ...segments), path.join(destination, ...segments), constants.COPYFILE_EXCL)
  written.add(relative)
  await fs.chmod(path.join(destination, ...segments), 0o600)
  if (expected) {
    const actual = await digest(path.join(destination, ...segments))
    ensure(actual.size === expected.size && actual.sha256 === expected.sha256, 'La copia no coincide con la huella de origen. Detén la API y vuelve a intentarlo.')
  }
}

async function publish(stage, destination, manifest) {
  const written = new Set()
  // mkdir is exclusive even if another process creates an empty destination
  // between validation and publication. Never rename over an existing folder.
  await fs.mkdir(destination, { mode: 0o700 })
  try {
    await fs.mkdir(path.join(destination, 'media'), { mode: 0o700 })
    for (const entry of manifest.files) await exclusiveCopy(stage, destination, entry.path, written)
    await exclusiveCopy(stage, destination, MANIFEST, written)
    await verifyBackup(destination)
  } catch (error) {
    await cleanup(destination, written)
    throw error
  }
}

/** Verify only; never opens the supplied database writable or reads .env. */
export async function verifyBackup(sourceInput) {
  const source = normalized(sourceInput, 'Respaldo')
  await noLinkedAncestors(source)
  const tree = await scanTree(source)
  const manifestPath = path.join(source, MANIFEST)
  const stat = await regularFile(manifestPath)
  ensure(stat.size <= 16 * 1024 * 1024, 'El manifiesto es demasiado grande.')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  ensure(manifest?.format === FORMAT && manifest.version === 1 && Array.isArray(manifest.files) && manifest.files.length > 0, 'El manifiesto de respaldo no es válido o su versión no es compatible.')
  ensure(typeof manifest.createdAt === 'string' && Number.isFinite(Date.parse(manifest.createdAt)), 'El manifiesto no contiene una fecha válida.')
  const bundledPhotos = manifest.bundledPhotos === undefined ? [] : manifest.bundledPhotos
  await validateBundledPhotos(bundledPhotos)
  const allowed = new Set([MANIFEST])
  for (const entry of manifest.files) {
    ensure(entry && typeof entry.path === 'string' && (entry.path === DATABASE || MEDIA_PATH.test(entry.path)), 'El manifiesto contiene una ruta no permitida.')
    ensure(!allowed.has(entry.path), 'El manifiesto contiene archivos duplicados.')
    ensure(Number.isSafeInteger(entry.size) && entry.size > 0 && /^[a-f0-9]{64}$/.test(entry.sha256), 'El manifiesto contiene metadatos de integridad inválidos.')
    allowed.add(entry.path)
    const target = path.join(source, ...entry.path.split('/'))
    const actual = await digest(target)
    ensure(actual.size === entry.size && actual.sha256 === entry.sha256, `La integridad SHA-256 no coincide: ${entry.path}`)
    if (MEDIA_PATH.test(entry.path)) await imageHeader(target, entry.path)
  }
  ensure(allowed.has(DATABASE), 'Falta la base SQLite en el manifiesto.')
  for (const entry of tree) ensure(entry.directory ? entry.relative === 'media' : allowed.has(entry.relative), `El respaldo contiene una entrada no declarada: ${entry.relative}`)
  await databaseHeader(path.join(source, DATABASE), true)
  const database = inspectDatabase(path.join(source, DATABASE))
  ensure(JSON.stringify(database.bundledPhotos) === JSON.stringify([...bundledPhotos].sort()), 'Las dependencias de fotografías estáticas no coinciden con las referencias de la base.')
  ensure(JSON.stringify(database.media) === JSON.stringify(manifest.files.filter((entry) => MEDIA_PATH.test(entry.path)).map((entry) => entry.path).sort()), 'Las fotografías declaradas no coinciden con las referencias de la base.')
  ensure(manifest.counts && Object.entries(database.counts).every(([key, value]) => manifest.counts[key] === value), 'Los recuentos del manifiesto no coinciden con la base.')
  return manifest
}

/** Offline snapshot: reads source bytes only; WAL recovery occurs in staging. */
export async function createBackup({ source: sourceInput, destination: destinationInput, offline = false }) {
  ensure(offline === true, 'Detén la API y confirma la operación offline con --offline.')
  const { source, destination } = await validateLocations(sourceInput, destinationInput)
  const stage = await stageFor(destination, 'backup')
  const written = new Set([`${DATABASE}-wal`, `${DATABASE}-shm`, `${DATABASE}-journal`])
  const fingerprints = new Map()
  try {
    await databaseHeader(path.join(source, DATABASE))
    ensure(!await exists(path.join(source, `${DATABASE}-journal`)), 'Hay un journal de recuperación. Recupera primero la base con la API y deténla limpiamente antes del respaldo.')
    const walExists = await exists(path.join(source, `${DATABASE}-wal`))
    for (const relative of [DATABASE, ...(walExists ? [`${DATABASE}-wal`] : [])]) {
      fingerprints.set(relative, await digest(path.join(source, relative)))
      await exclusiveCopy(source, stage, relative, written, fingerprints.get(relative))
    }
    // Source is never opened with SQLite, so this cannot checkpoint or create
    // WAL/SHM files beside the original. Recover the copied WAL, if present.
    const copied = new DatabaseSync(path.join(stage, DATABASE))
    try {
      copied.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;')
      const checkpoint = copied.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
      ensure(!checkpoint || Number(checkpoint.busy) === 0, 'No se pudo consolidar el WAL copiado.')
      const mode = copied.prepare('PRAGMA journal_mode=DELETE').get()
      ensure(mode?.journal_mode === 'delete', 'No se pudo cerrar la copia SQLite sin archivos auxiliares.')
    } finally { copied.close() }
    const database = inspectDatabase(path.join(stage, DATABASE))
    await validateBundledPhotos(database.bundledPhotos)
    await fs.mkdir(path.join(stage, 'media'), { mode: 0o700 })
    for (const relative of database.media) {
      const target = path.join(source, ...relative.split('/'))
      fingerprints.set(relative, await digest(target))
      await imageHeader(target, relative)
      await exclusiveCopy(source, stage, relative, written, fingerprints.get(relative))
    }
    for (const [relative, previous] of fingerprints) {
      const current = await digest(path.join(source, ...relative.split('/')))
      ensure(previous.sha256 === current.sha256 && previous.size === current.size, 'La fuente cambió durante el respaldo. Detén la API y vuelve a intentarlo.')
    }
    ensure(walExists === await exists(path.join(source, `${DATABASE}-wal`)), 'El WAL cambió durante el respaldo. Detén la API y vuelve a intentarlo.')
    const manifest = {
      format: FORMAT, version: 1, createdAt: new Date().toISOString(),
      consistency: 'offline-copy-with-local-wal-checkpoint', counts: database.counts,
      bundledPhotos: database.bundledPhotos,
      files: await Promise.all([DATABASE, ...database.media].map(async (relative) => ({ path: relative, ...await digest(path.join(stage, ...relative.split('/'))) }))),
    }
    await fs.writeFile(path.join(stage, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    written.add(MANIFEST)
    await verifyBackup(stage)
    await publish(stage, destination, manifest)
    return { destination, manifest }
  } finally { await cleanup(stage, written) }
}

/** Shared safe destination staging for restore; never mutates source. */
export async function restoreVerifiedBackup({ source: sourceInput, destination: destinationInput, offline = false }) {
  ensure(offline === true, 'Detén la API y confirma la operación offline con --offline.')
  const { source, destination } = await validateLocations(sourceInput, destinationInput)
  const manifest = await verifyBackup(source)
  const stage = await stageFor(destination, 'restore')
  const written = new Set()
  try {
    await fs.mkdir(path.join(stage, 'media'), { mode: 0o700 })
    for (const entry of manifest.files) await exclusiveCopy(source, stage, entry.path, written, entry)
    await exclusiveCopy(source, stage, MANIFEST, written)
    await verifyBackup(stage)
    await publish(stage, destination, manifest)
    return { destination, manifest }
  } finally { await cleanup(stage, written) }
}

export function parseArguments(argumentsList) {
  const options = { offline: false }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--help') return { help: true }
    if (argument === '--offline') { ensure(!options.offline, 'No repitas --offline.'); options.offline = true; continue }
    ensure(argument === '--source' || argument === '--destination', `Argumento no admitido: ${argument}`)
    const key = argument.slice(2)
    ensure(!options[key], `No repitas ${argument}.`)
    const value = argumentsList[++index]
    ensure(value && !value.startsWith('--'), `Falta la ruta de ${argument}.`)
    options[key] = value
  }
  ensure(options.source && options.destination, 'Debes indicar --source y --destination con rutas explícitas.')
  return options
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMain()) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) console.log('Uso: node scripts/backup.mjs --source "DATA_DIR/live" --destination "DIRECTORIO_NUEVO" --offline\nLa API debe estar detenida. Copia SQLite y subidas /media; registra fotografías del paquete como dependencias. Nunca copia .env ni claves externas.')
    else {
      const { destination, manifest } = await createBackup(options)
      console.log(`Respaldo verificado: ${destination}\nReservas: ${manifest.counts.bookings}; fotografías: ${manifest.counts.photos}; archivos incluidos: ${manifest.files.length}; dependencias de fotografías del paquete: ${manifest.bundledPhotos?.length || 0}.`)
    }
  } catch (error) { console.error(`No se creó el respaldo: ${error.message}`); process.exitCode = 1 }
}
