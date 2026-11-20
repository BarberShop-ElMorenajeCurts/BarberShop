import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadConfig, TWO_HOURS, DAY } from './config.mjs'
import { Store } from './store.mjs'
import { DemoAdapter, GoogleError } from './google.mjs'
import { BookingService } from './service.mjs'

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'barber-server-test-'))
  const config = loadConfig({ APP_MODE: 'demo', DATA_DIR: directory, APP_ORIGIN: 'http://localhost:8443' })
  let timestamp = Date.parse('2026-11-16T12:00:00Z') // Monday 08:00 in Curaçao.
  const now = () => timestamp, store = new Store(config.dataDir, { demo: true }), adapter = new DemoAdapter(store), emails = []
  adapter.sendEmail = async message => { emails.push(message); return { id: 'test' } }
  const service = new BookingService(config, store, adapter, { now })
  t.after(() => { store.close(); if (path.dirname(directory) === os.tmpdir()) rmSync(directory, { recursive: true, force: true }) })
  const input = (hours = 4) => ({ serviceId: 'fade', barberId: 'barber-1', startAt: new Date(timestamp + hours * 3600000).toISOString(), customer: { name: 'Cliente de prueba', email: 'client@example.com', phone: '+59991234567' }, language: 'es', idempotencyKey: randomUUID() })
  return { config, store, adapter, service, emails, input, now, advance: milliseconds => { timestamp += milliseconds } }
}

test('public requests require strictly more than two hours, valid customer, and working hours', async t => {
  const f = fixture(t)
  await assert.rejects(f.service.create(f.input(2)), { code: 'BOOKING_TOO_SOON' })
  await assert.rejects(f.service.create({ ...f.input(), customer: { name: 'A', email: 'bad', phone: '1' } }), { code: 'INVALID_CUSTOMER' })
  await assert.rejects(f.service.create(f.input(12)), { code: 'OUTSIDE_WORKING_HOURS' })
  const slots = await f.service.available('fade', 'barber-1', '2026-11-16')
  assert.ok(slots.slots.every(slot => Date.parse(slot.startAt) > f.now() + TWO_HOURS))
})

test('simultaneous overlapping requests produce one hold and no duplicate Calendar event', async t => {
  const f = fixture(t), a = f.input(), b = { ...f.input(), startAt: a.startAt }
  const results = await Promise.allSettled([f.service.create(a), f.service.create(b)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SLOT_UNAVAILABLE')
  assert.equal(f.store.bookings().length, 1)
  assert.equal(f.store.events('demo-calendar-1').filter(e => e.status !== 'cancelled').length, 1)
  const b1 = f.store.bookings()[0]
  assert.equal(b1.status, 'pending'); assert.equal(b1.syncStatus, 'synced')
  assert.equal(Date.parse(b1.autoConfirmAt), f.now() + TWO_HOURS)
  assert.equal(f.store.events('demo-calendar-1')[0].attendees.length, 0)
})

test('idempotency retains original deadline and rejects different private customer data', async t => {
  const f = fixture(t), input = f.input(), first = await f.service.create(input)
  f.advance(10 * 60000)
  const replay = await f.service.create(input)
  assert.equal(replay.id, first.id); assert.equal(replay.autoConfirmAt, first.autoConfirmAt)
  await assert.rejects(f.service.create({ ...input, customer: { ...input.customer, email: 'other@example.com' } }), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(f.store.bookings().length, 1)
})

test('automatic confirmation survives a restart, keeps one event and never repeats email jobs', async t => {
  const f = fixture(t), receipt = await f.service.create(f.input())
  const eventId = f.store.booking(receipt.id).googleEventId
  await f.service.runJobs()
  f.advance(TWO_HOURS)
  // Reconstruct the worker using persisted jobs rather than browser state.
  const recovered = new BookingService(f.config, f.store, f.adapter, { now: f.now })
  await recovered.runJobs(); await recovered.runJobs(); await recovered.runJobs()
  const b = f.store.booking(receipt.id)
  assert.equal(b.status, 'confirmed'); assert.equal(b.confirmationSource, 'automatic'); assert.equal(b.googleEventId, eventId)
  assert.equal(f.store.events('demo-calendar-1').filter(e => e.status !== 'cancelled').length, 1)
  assert.equal(f.store.events('demo-calendar-1')[0].attendees[0].email, 'client@example.com')
  assert.equal(f.emails.filter(e => e.subject.includes('Cita confirmada')).length, 1)
})

test('reject before the deadline prevents confirmation; reject at deadline cannot extend review', async t => {
  const f = fixture(t), first = await f.service.create(f.input())
  const rejected = await f.service.action(first.id, { action: 'reject', expectedVersion: 1 })
  assert.equal(rejected.status, 'rejected')
  f.advance(TWO_HOURS); await f.service.runJobs()
  assert.equal(f.store.booking(first.id).status, 'rejected')
  const second = await f.service.create(f.input())
  f.advance(TWO_HOURS)
  await assert.rejects(f.service.action(second.id, { action: 'reject', expectedVersion: 1 }), { code: 'REVIEW_DEADLINE_PASSED' })
  const cancelled = await f.service.action(second.id, { action: 'cancel', expectedVersion: 1 })
  await f.service.runJobs()
  assert.equal(cancelled.status, 'cancelled'); assert.equal(f.store.booking(second.id).status, 'cancelled')
})

test('manual approval and cancellation enforce optimistic versions and invalidate reminder jobs', async t => {
  const f = fixture(t), input = { ...f.input(), startAt: '2026-11-19T16:00:00Z' }
  const receipt = await f.service.create(input)
  const b = await f.service.action(receipt.id, { action: 'approve', expectedVersion: 1 })
  assert.equal(b.status, 'confirmed'); assert.equal(b.version, 2)
  assert.ok(f.store.db.prepare("SELECT id FROM jobs WHERE kind='reminder' AND state='pending'").get())
  await assert.rejects(f.service.action(b.id, { action: 'cancel', expectedVersion: 1 }), { code: 'VERSION_CONFLICT' })
  await f.service.action(b.id, { action: 'cancel', expectedVersion: 2 })
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE kind='reminder' AND state='pending'").get().count, 0)
})

test('rescheduling pending retains deadline and a different barber uses the destination calendar', async t => {
  const f = fixture(t), receipt = await f.service.create(f.input()), original = f.store.booking(receipt.id)
  const changed = await f.service.action(receipt.id, { action: 'reschedule', expectedVersion: 1, barberId: 'barber-2', startAt: '2026-11-16T18:00:00Z' })
  assert.equal(changed.autoConfirmAt, receipt.autoConfirmAt)
  assert.equal(changed.barberId, 'barber-2'); assert.equal(changed.syncStatus, 'synced')
  assert.equal(f.store.booking(changed.id).googleCalendarId, 'demo-calendar-2')
  assert.equal(f.store.booking(changed.id).googleEventId, original.googleEventId)
})

test('direct Calendar move updates booking without renewing the deadline; deletion cancels', async t => {
  const f = fixture(t), receipt = await f.service.create(f.input()), original = f.store.booking(receipt.id), event = f.store.events('demo-calendar-1')[0]
  f.store.saveEvent('demo-calendar-1', { ...event, etag: 'external-move', start: { dateTime: '2026-11-16T18:00:00Z' }, end: { dateTime: '2026-11-16T18:45:00Z' } })
  await f.service.syncCalendars()
  const changed = f.store.booking(receipt.id)
  assert.equal(changed.startAt, '2026-11-16T18:00:00.000Z'); assert.equal(changed.autoConfirmAt, original.autoConfirmAt)
  f.store.saveEvent('demo-calendar-1', { ...event, etag: 'deleted', status: 'cancelled' })
  await f.service.syncCalendars(); f.advance(TWO_HOURS); await f.service.runJobs()
  assert.equal(f.store.booking(receipt.id).status, 'cancelled')
})

test('external busy events and all-day events block availability without leaking details', async t => {
  const f = fixture(t)
  f.store.saveEvent('demo-calendar-1', { id: 'external', status: 'confirmed', summary: 'PRIVATE', start: { dateTime: '2026-11-16T16:00:00Z' }, end: { dateTime: '2026-11-16T17:00:00Z' } })
  const slots = await f.service.available('fade', 'barber-1', '2026-11-16')
  assert.ok(!slots.slots.some(s => s.startAt === '2026-11-16T16:00:00.000Z'))
  assert.ok(!JSON.stringify(slots).includes('PRIVATE'))
  assert.ok(f.service.remoteConflict([{ id: 'day', start: { date: '2026-11-16' }, end: { date: '2026-11-17' } }], Date.parse('2026-11-16T16:00:00Z'), Date.parse('2026-11-16T17:00:00Z')))
})

test('Calendar failure retains local hold and retry fixes the same event without a false success', async t => {
  const f = fixture(t), original = f.adapter.upsert.bind(f.adapter), input = f.input()
  let fail = true
  f.adapter.upsert = async (...args) => { if (fail) throw new GoogleError(503, 'GOOGLE_API_ERROR'); return original(...args) }
  await assert.rejects(f.service.create(input), { code: 'GOOGLE_SYNC_ERROR' })
  assert.equal(f.store.bookings().length, 1); assert.equal(f.store.bookings()[0].syncStatus, 'error')
  await assert.rejects(f.service.create({ ...f.input(), startAt: input.startAt }), { code: 'SLOT_UNAVAILABLE' })
  fail = false; f.advance(11000); await f.service.runJobs()
  assert.equal(f.store.bookings()[0].syncStatus, 'synced'); assert.equal(f.store.events('demo-calendar-1').length, 1)
})

test('sync token reset recovers a full snapshot; a past appointment never auto-confirms', async t => {
  const f = fixture(t), receipt = await f.service.create(f.input()), original = f.adapter.listChanges.bind(f.adapter)
  f.store.set('sync:demo-calendar-1', 'expired')
  f.adapter.listChanges = async (id, token) => { if (token === 'expired') throw new GoogleError(410, 'GOOGLE_SYNC_TOKEN_EXPIRED'); return original(id) }
  await f.service.syncCalendars(); assert.equal(f.store.get('sync:demo-calendar-1'), 'demo')
  f.advance(5 * 3600000); await f.service.runJobs()
  assert.equal(f.store.booking(receipt.id).status, 'pending'); assert.equal(f.store.booking(receipt.id).syncStatus, 'error')
})

test('reminders are scheduled at 24h, omitted retroactively, and uncertain Gmail delivery is not retried', async t => {
  const f = fixture(t), receipt = await f.service.create({ ...f.input(), startAt: '2026-11-19T16:00:00Z' })
  await f.service.action(receipt.id, { action: 'approve', expectedVersion: 1 })
  await f.service.runJobs()
  f.advance(Date.parse('2026-11-18T16:00:00Z') - f.now())
  await f.service.runJobs(); await f.service.runJobs()
  assert.equal(f.emails.filter(e => e.subject.includes('Tu cita es mañana')).length, 1)
  const another = await f.service.create(f.input())
  await f.service.action(another.id, { action: 'approve', expectedVersion: 1 })
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE kind='reminder' AND booking=? AND state='pending'").get(another.id).count, 0)
  f.adapter.sendEmail = async () => { throw new GoogleError(0, 'GOOGLE_NETWORK_ERROR') }
  await f.service.runJobs(); const attempts = f.store.db.prepare("SELECT attempts FROM jobs WHERE state='uncertain' LIMIT 1").get()
  assert.ok(attempts); f.advance(DAY); await f.service.runJobs()
  assert.equal(f.store.db.prepare("SELECT attempts FROM jobs WHERE state='uncertain' LIMIT 1").get().attempts, attempts.attempts)
})

test('photos validate bytes and type, persist metadata, and can be replaced or removed', t => {
  const f = fixture(t), png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII='
  const p = f.service.uploadPhoto({ dataUrl: `data:image/png;base64,${png}`, section: 'hero', alt: { es: 'Prueba', en: 'Test' }, sortOrder: 1 })
  assert.ok(f.service.catalog().photos.some(photo => photo.id === p.id))
  f.service.updatePhoto(p.id, { section: 'gallery', sortOrder: 2 })
  assert.equal(f.service.catalog().photos[0].section, 'gallery')
  assert.throws(() => f.service.uploadPhoto({ dataUrl: `data:image/jpeg;base64,${png}`, section: 'hero', alt: { es: '', en: '' }, sortOrder: 0 }), { code: 'INVALID_IMAGE' })
  f.service.deletePhoto(p.id); assert.equal(f.service.catalog().photos.length, 0)
})

test('replacing image bytes keeps identity and metadata while changing its cache URL', t => {
  const f = fixture(t), dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII='
  const original = f.service.uploadPhoto({ dataUrl, section: 'hero', alt: { es: 'Original', en: 'Original' }, sortOrder: 7 })
  const previousPath = path.join(f.config.mediaDir, path.basename(original.url))
  const next = f.service.updatePhoto(original.id, { dataUrl })
  assert.equal(next.id, original.id)
  assert.notEqual(next.url, original.url)
  assert.equal(next.section, original.section)
  assert.deepEqual(next.alt, original.alt)
  assert.equal(next.sortOrder, original.sortOrder)
  assert.equal(existsSync(previousPath), false)
  assert.equal(existsSync(path.join(f.config.mediaDir, path.basename(next.url))), true)
  assert.deepEqual(f.service.catalog().photos, [next])
  assert.equal(readdirSync(f.config.mediaDir).length, 1)
})

test('failed photo replacement preserves the previous image and cleans the uncommitted file', t => {
  const f = fixture(t), dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII='
  const original = f.service.uploadPhoto({ dataUrl, section: 'gallery', alt: { es: 'Original', en: 'Original' }, sortOrder: 2 })
  const originalPath = path.join(f.config.mediaDir, path.basename(original.url)), originalBytes = readFileSync(originalPath)
  assert.throws(() => f.service.updatePhoto(original.id, { dataUrl: dataUrl.replace('image/png', 'image/jpeg') }), { code: 'INVALID_IMAGE' })
  assert.deepEqual(f.service.catalog().photos, [original])
  const audit = f.store.audit.bind(f.store)
  f.store.audit = () => { throw new Error('simulated database failure') }
  try { assert.throws(() => f.service.updatePhoto(original.id, { dataUrl, section: 'hero' }), /simulated database failure/) }
  finally { f.store.audit = audit }
  assert.deepEqual(f.service.catalog().photos, [original])
  assert.deepEqual(readFileSync(originalPath), originalBytes)
  assert.deepEqual(readdirSync(f.config.mediaDir), [path.basename(original.url)])
})

test('replacing or retiring a bundled photograph never deletes a same-named upload file', t => {
  const f = fixture(t), dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII='
  const bundled = { id: 'owned-original', section: 'hero', url: '/assets/photos/owned-original.jpg', alt: { es: 'Original', en: 'Original' }, sortOrder: 0 }
  const unrelated = path.join(f.config.mediaDir, path.basename(bundled.url))
  writeFileSync(unrelated, 'unrelated upload bytes')
  f.store.put('photos', bundled)
  const replaced = f.service.updatePhoto(bundled.id, { dataUrl })
  assert.equal(replaced.id, bundled.id)
  assert.ok(replaced.url.startsWith('/media/'))
  assert.equal(readFileSync(unrelated, 'utf8'), 'unrelated upload bytes')
  const retired = { ...bundled, id: 'owned-retired' }
  f.store.put('photos', retired)
  f.service.deletePhoto(retired.id)
  assert.equal(readFileSync(unrelated, 'utf8'), 'unrelated upload bytes')
  assert.equal(f.store.all('photos').some(photo => photo.id === retired.id), false)
  const uploadedPath = path.join(f.config.mediaDir, path.basename(replaced.url))
  f.service.deletePhoto(replaced.id)
  assert.equal(existsSync(uploadedPath), false)
  assert.equal(readFileSync(unrelated, 'utf8'), 'unrelated upload bytes')
})

test('Calendar edit racing a local reschedule enters review and can be explicitly resolved', async t => {
  const f = fixture(t), receipt = await f.service.create(f.input()), original = f.adapter.upsert.bind(f.adapter)
  let raced = false
  f.adapter.upsert = async (...args) => {
    if (!raced && args[0].version === 2) {
      raced = true
      const event = f.store.events('demo-calendar-1')[0]
      f.store.saveEvent('demo-calendar-1', { ...event, etag: 'external-race', start: { dateTime: '2026-11-16T19:00:00Z' }, end: { dateTime: '2026-11-16T19:45:00Z' } })
      throw new GoogleError(412, 'GOOGLE_CONCURRENT_CHANGE')
    }
    return original(...args)
  }
  const rescheduled = await f.service.action(receipt.id, { action: 'reschedule', expectedVersion: 1, startAt: '2026-11-16T18:00:00Z' })
  assert.equal(rescheduled.syncStatus, 'error')
  await f.service.syncCalendars()
  const reviewed = f.store.booking(receipt.id)
  assert.equal(reviewed.startAt, '2026-11-16T19:00:00.000Z'); assert.equal(reviewed.reviewRequired, true)
  assert.equal(reviewed.version, 3); assert.equal(reviewed.autoConfirmAt, receipt.autoConfirmAt)
  const approved = await f.service.action(receipt.id, { action: 'approve', expectedVersion: 3 })
  assert.equal(approved.status, 'confirmed'); assert.equal(approved.syncStatus, 'synced')
})
