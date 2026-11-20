import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { seedCatalog } from './config.mjs'
import photography from '../config/photography.public.json' with { type: 'json' }

export class Store {
  constructor(directory, { demo = false } = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path.join(directory, 'appointments.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, barber TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS booking_overlap ON bookings(barber,start,end,status);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, booking TEXT, due INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL, error TEXT);
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,due);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (calendar TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(calendar,id));
      CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,booking TEXT,detail TEXT NOT NULL);
    `)
    if (!this.get('catalog')) this.set('catalog', seedCatalog(demo))
    // A one-time migration: never replace an administrator's publication or
    // restore photographs they subsequently removed from the website.
    if (!demo) this.transaction(() => {
      if (this.get('photography.seed.v1')) return
      if (this.all('photos').length === 0) {
        if (!Array.isArray(photography) || photography.some(photo => !photo || typeof photo.id !== 'string' || !['hero', 'gallery', 'barbers'].includes(photo.section) || !/^\/assets\/photos\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/.test(photo.url) || typeof photo.alt?.es !== 'string' || typeof photo.alt?.en !== 'string' || !Number.isInteger(photo.sortOrder)) || new Set(photography.map(photo => photo.id)).size !== photography.length) throw new Error('El manifiesto público de fotografías no es válido.')
        for (const photo of photography) this.put('photos', photo)
      }
      this.set('photography.seed.v1', true)
    })
    // Calendar operations use stable IDs on recovery. Gmail has no idempotency
    // key: a crashed send could already have been delivered, so do not replay it.
    this.db.prepare("UPDATE jobs SET state='uncertain',error='El servidor se detuvo durante el envío; entrega desconocida.' WHERE state='running' AND kind IN ('email','reminder')").run()
    this.db.prepare("UPDATE jobs SET state='pending' WHERE state='running'").run()
  }
  close() { this.db.close() }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  get(key) { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : null }
  set(key, value) { this.db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)) }
  remove(key) { this.db.prepare('DELETE FROM kv WHERE key=?').run(key) }
  booking(id) { const row = this.db.prepare('SELECT body FROM bookings WHERE id=?').get(id); return row ? JSON.parse(row.body) : null }
  byIdempotency(idem) { const row = this.db.prepare('SELECT body,hash FROM bookings WHERE idem=?').get(idem); return row ? { booking: JSON.parse(row.body), hash: row.hash } : null }
  bookings() { return this.db.prepare('SELECT body FROM bookings ORDER BY start DESC').all().map(r => JSON.parse(r.body)) }
  saveBooking(b) {
    this.db.prepare(`INSERT INTO bookings(id,idem,hash,barber,start,end,status,body) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET barber=excluded.barber,start=excluded.start,end=excluded.end,status=excluded.status,body=excluded.body`).run(b.id, b.idempotencyKey, b.inputHash, b.barberId, Date.parse(b.startAt), Date.parse(b.endAt), b.status, JSON.stringify(b))
  }
  overlaps(barber, start, end, exclude = '') {
    return this.db.prepare("SELECT id FROM bookings WHERE barber=? AND start<? AND end>? AND status IN ('pending','confirmed') AND id<>? LIMIT 1").get(barber, end, start, exclude)
  }
  all(table) {
    if (!['photos', 'blocks'].includes(table)) throw new Error('Tabla no admitida')
    return this.db.prepare(`SELECT body FROM ${table}`).all().map(r => JSON.parse(r.body))
  }
  put(table, value) {
    if (!['photos', 'blocks'].includes(table)) throw new Error('Tabla no admitida')
    this.db.prepare(`INSERT INTO ${table}(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`).run(value.id, JSON.stringify(value))
  }
  delete(table, id) {
    if (!['photos', 'blocks'].includes(table)) throw new Error('Tabla no admitida')
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
  }
  job(id, kind, booking, due, payload = {}) {
    this.db.prepare('INSERT OR IGNORE INTO jobs(id,kind,booking,due,payload) VALUES(?,?,?,?,?)').run(id, kind, booking, due, JSON.stringify(payload))
  }
  dueJobs(now) { return this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND due<=? ORDER BY due,id LIMIT 100").all(now).map(r => ({ ...r, payload: JSON.parse(r.payload) })) }
  finishJob(id) { this.db.prepare("UPDATE jobs SET state='done',error=NULL WHERE id=?").run(id) }
  cancelJobs(booking, kinds = null) {
    const rows = this.db.prepare("SELECT id,kind FROM jobs WHERE booking=? AND state IN ('pending','running')").all(booking)
    for (const row of rows) if (!kinds || kinds.includes(row.kind)) this.db.prepare("UPDATE jobs SET state='cancelled' WHERE id=?").run(row.id)
  }
  events(calendar = null) { return (calendar ? this.db.prepare('SELECT body FROM events WHERE calendar=?').all(calendar) : this.db.prepare('SELECT body FROM events').all()).map(r => JSON.parse(r.body)) }
  saveEvent(calendar, event) { this.db.prepare('INSERT INTO events(calendar,id,body) VALUES(?,?,?) ON CONFLICT(calendar,id) DO UPDATE SET body=excluded.body').run(calendar, event.id, JSON.stringify({ ...event, _calendarId: calendar })) }
  clearEvents(calendar) { this.db.prepare('DELETE FROM events WHERE calendar=?').run(calendar) }
  audit(action, bookingId, detail, now = Date.now()) { this.db.prepare('INSERT INTO audit(id,at,action,booking,detail) VALUES(?,?,?,?,?)').run(randomUUID(), new Date(now).toISOString(), action, bookingId, detail) }
  audits() { return this.db.prepare('SELECT id,at,action,booking AS bookingId,detail FROM audit ORDER BY at DESC LIMIT 200').all() }
}
