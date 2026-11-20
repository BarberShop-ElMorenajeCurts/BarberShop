import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, lstatSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { loadConfig, seedCatalog } from './config.mjs'
import { catalogInput } from './validation.mjs'
import { Store } from './store.mjs'
import { DemoAdapter } from './google.mjs'
import { BookingService } from './service.mjs'
import photography from '../config/photography.public.json' with { type: 'json' }

function fixture(t, { demo = false, now = Date.now } = {}) {
  const parent = path.resolve(os.tmpdir())
  const root = mkdtempSync(path.join(parent, 'elmorenaje-catalog-'))
  const config = loadConfig({ APP_MODE: demo ? 'demo' : 'setup', DATA_DIR: root })
  const store = new Store(config.dataDir, { demo })
  const service = new BookingService(config, store, new DemoAdapter(store), { now })
  t.after(() => {
    store.close()
    assert.equal(path.dirname(root), parent)
    assert.ok(path.basename(root).startsWith('elmorenaje-catalog-'))
    assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink())
    rmSync(root, { recursive: true, force: true })
  })
  return { config, store, service }
}

test('initial business catalog uses supplied services, contacts, team and schedule without enabling bookings', t => {
  const f = fixture(t), catalog = f.service.catalog()
  assert.deepEqual(catalog.services.map(s => [s.name.es, s.price, s.currency, s.durationMinutes]), [
    ['Corte de pelo + barba', 40, 'ANG', 30],
    ['Corte de pelo (sin barba)', 35, 'ANG', 30],
    ['Corte para niños', 30, 'ANG', 30],
    ['Lavado de pelo', 5, 'ANG', 30],
    ['Cejas (damas)', 10, 'ANG', 30],
  ])
  assert.deepEqual(catalog.barbers.map(b => b.name), ['Moreno', 'Nestor', 'Reimon', 'Noel'])
  assert.equal(catalog.settings.whatsapp, '+59996768925')
  assert.equal(catalog.settings.facebook, 'https://www.facebook.com/el_morenajecuts')
  assert.equal(catalog.settings.businessDataConfirmed, false)
  assert.equal(catalog.bookingEnabled, false)
  for (const barber of catalog.barbers) {
    assert.equal('calendarId' in barber, false)
    assert.deepEqual(barber.serviceIds, catalog.services.map(s => s.id))
    assert.deepEqual(barber.weeklyHours, [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '21:00' })))
  }
})

test('bundled photographs are seeded once and administrative edits or removals survive another startup', t => {
  const f = fixture(t)
  assert.equal(photography.length, 31)
  assert.deepEqual(f.store.all('photos'), photography)
  const [edited, removed] = photography
  const customized = { ...edited, alt: { es: 'Descripción administrada', en: 'Administrator description' }, sortOrder: 88 }
  f.store.put('photos', customized)
  f.service.deletePhoto(removed.id)
  const restarted = new Store(f.config.dataDir)
  try {
    assert.equal(restarted.all('photos').length, photography.length - 1)
    assert.equal(restarted.all('photos').some(photo => photo.id === removed.id), false)
    assert.deepEqual(restarted.all('photos').find(photo => photo.id === edited.id), customized)
    assert.equal(restarted.get('photography.seed.v1'), true)
  } finally { restarted.close() }
})

test('technical demo has no bundled photographs and an existing publication is never replaced on migration', t => {
  const f = fixture(t, { demo: true })
  assert.deepEqual(f.store.all('photos'), [])
  assert.equal(f.store.get('photography.seed.v1'), null)
  const managed = { id: 'existing-administrator-photo', section: 'hero', url: '/media/11111111-1111-1111-1111-111111111111.jpg', alt: { es: 'Publicación existente', en: 'Existing publication' }, sortOrder: 1 }
  f.store.put('photos', managed)
  const migrated = new Store(f.config.dataDir)
  try {
    assert.deepEqual(migrated.all('photos'), [managed])
    assert.equal(migrated.get('photography.seed.v1'), true)
    migrated.delete('photos', managed.id)
  } finally { migrated.close() }
  const restarted = new Store(f.config.dataDir)
  try { assert.deepEqual(restarted.all('photos'), []) }
  finally { restarted.close() }
})

test('demo catalog remains isolated from the supplied commercial catalog', () => {
  const demo = seedCatalog(true), business = seedCatalog(false)
  assert.equal(demo.services.length, 4)
  assert.equal(demo.services[0].durationMinutes, 45)
  assert.equal(demo.services[0].currency, 'USD')
  assert.equal(demo.barbers.length, 2)
  demo.services[0].name.es = 'Changed demo'
  business.services[0].name.es = 'Changed business'
  assert.equal(seedCatalog(false).services[0].name.es, 'Corte de pelo + barba')
})

test('catalog preparation accepts unknown durations and legacy settings without Facebook', () => {
  const input = seedCatalog(false)
  input.services[0].durationMinutes = null
  delete input.settings.facebook
  const prepared = catalogInput(input)
  assert.equal(prepared.services[0].durationMinutes, null)
  assert.equal(prepared.settings.facebook, '')
  for (const invalid of [0, 4, 481, '30', NaN]) {
    input.services[0].durationMinutes = invalid
    assert.throws(() => catalogInput(input), { code: 'VALIDATION_ERROR' })
  }
})

test('unknown duration blocks readiness and cannot become a zero-length appointment', t => {
  const f = fixture(t), input = seedCatalog(false)
  input.settings.businessDataConfirmed = true
  input.barbers.forEach((barber, i) => { barber.calendarId = `fixture-calendar-${i}` })
  f.config.mode = 'live'
  f.store.set('catalog', catalogInput(input))
  assert.equal(f.service.catalog().bookingEnabled, true)
  input.services[0].durationMinutes = null
  f.store.set('catalog', catalogInput(input))
  assert.equal(f.service.integration().businessReady, false)
  assert.equal(f.service.catalog().bookingEnabled, false)
  assert.throws(() => f.service.pair(input.services[0].id, input.barbers[0].id), { code: 'SERVICE_NOT_CONFIGURED' })
})

test('Facebook is editable as HTTPS contact and rejects executable or credential-bearing URLs', () => {
  const input = seedCatalog(false)
  input.settings.facebook = 'https://www.facebook.com/updated-page'
  assert.equal(catalogInput(input).settings.facebook, input.settings.facebook)
  for (const unsafe of ['javascript:alert(1)', 'http://facebook.com/example', 'https://user:password@facebook.com/example']) {
    input.settings.facebook = unsafe
    assert.throws(() => catalogInput(input), { code: 'VALIDATION_ERROR' })
  }
})

test('new initial data does not overwrite a catalog already persisted by an administrator', t => {
  const f = fixture(t)
  const custom = f.store.get('catalog')
  custom.settings.name = 'Administrator-edited catalog'
  f.store.set('catalog', custom)
  const second = new Store(f.config.dataDir)
  try { assert.equal(second.get('catalog').settings.name, 'Administrator-edited catalog') }
  finally { second.close() }
})

test('catalog edits require the latest revision so another administrator cannot overwrite saved changes', async t => {
  const f = fixture(t), initial = f.service.catalog(true)
  const input = { settings: initial.settings, services: initial.services, barbers: initial.barbers }
  await assert.rejects(f.service.updateCatalog(input), { code: 'CATALOG_CHANGED', status: 409 })
  const first = structuredClone({ ...input, expectedRevision: initial.revision })
  first.barbers[0].name = 'Nombre actualizado'
  const saved = await f.service.updateCatalog(first)
  assert.notEqual(saved.revision, initial.revision)
  const second = structuredClone({ ...input, expectedRevision: initial.revision })
  second.settings.name = 'Una edición desactualizada'
  await assert.rejects(f.service.updateCatalog(second), { code: 'CATALOG_CHANGED', status: 409 })
  assert.equal(f.service.catalog(true).barbers[0].name, 'Nombre actualizado')
  assert.equal(f.service.catalog().settings.name, initial.settings.name)
  const latest = f.service.catalog(true)
  await f.service.updateCatalog({ expectedRevision: latest.revision, settings: latest.settings, services: latest.services, barbers: latest.barbers })
})

test('barbers with administrative blocks cannot be removed or have their calendar changed', async t => {
  const f = fixture(t), catalog = f.store.get('catalog')
  catalog.barbers[0].calendarId = 'private-calendar-original'
  f.store.set('catalog', catalog)
  f.store.put('blocks', { id: 'retained-block', barberId: catalog.barbers[0].id, startAt: '2026-11-17T13:00:00Z', endAt: '2026-11-17T14:00:00Z' })
  const payload = () => { const current = f.service.catalog(true); return { expectedRevision: current.revision, settings: current.settings, services: current.services, barbers: current.barbers } }
  const removed = payload(); removed.barbers.shift()
  await assert.rejects(f.service.updateCatalog(removed), { code: 'BARBER_BLOCKED', status: 409 })
  const changed = payload(); changed.barbers[0].calendarId = 'private-calendar-new'
  await assert.rejects(f.service.updateCatalog(changed), { code: 'CALENDAR_BLOCKED', status: 409 })
  assert.equal(f.store.get('catalog').barbers[0].calendarId, 'private-calendar-original')
  const disabled = payload(); disabled.barbers[0].active = false
  await f.service.updateCatalog(disabled)
  assert.equal(f.service.catalog(true).barbers[0].active, false)
  assert.equal(f.store.all('blocks').length, 1)
})

test('administrative catalog edits update public offers and availability while retaining existing appointments', async t => {
  const f = fixture(t, { demo: true, now: () => Date.parse('2026-11-16T12:00:00Z') })
  const payload = () => { const c = f.service.catalog(true); return { expectedRevision: c.revision, settings: c.settings, services: c.services, barbers: c.barbers } }
  const initial = payload(), serviceId = initial.services[0].id, barberId = initial.barbers[0].id
  const originalHours = structuredClone(initial.barbers[0].weeklyHours)
  const date = '2026-11-17', bookedStart = '2026-11-17T13:00:00.000Z', afternoonStart = '2026-11-17T17:00:00.000Z'
  const before = await f.service.available(serviceId, barberId, date)
  assert.ok(before.slots.some(slot => slot.startAt === bookedStart))
  const receipt = await f.service.create({ serviceId, barberId, startAt: bookedStart, customer: { name: 'Cliente de prueba', email: 'acceptance@example.invalid', phone: '+59991234567' }, language: 'es', idempotencyKey: randomUUID() })
  const existing = f.store.booking(receipt.id)
  assert.equal(existing.status, 'pending')
  assert.equal(Date.parse(existing.endAt) - Date.parse(existing.startAt), 45 * 60_000)

  const edited = payload()
  Object.assign(edited.services[0], { price: 42, currency: 'ANG', durationMinutes: 60 })
  edited.barbers[0].name = 'Barbero actualizado'
  edited.barbers[0].weeklyHours = originalHours.filter(hours => hours.weekday !== 2).concat({ weekday: 2, start: '13:00', end: '17:00' })
  await f.service.updateCatalog(edited)
  const publicCatalog = f.service.catalog(), publicService = publicCatalog.services.find(item => item.id === serviceId), publicBarber = publicCatalog.barbers.find(item => item.id === barberId)
  assert.deepEqual([publicService.price, publicService.currency, publicService.durationMinutes], [42, 'ANG', 60])
  assert.equal(publicBarber.name, 'Barbero actualizado')
  assert.deepEqual(publicBarber.weeklyHours.find(hours => hours.weekday === 2), { weekday: 2, start: '13:00', end: '17:00' })
  assert.ok(publicCatalog.barbers.every(barber => !Object.hasOwn(barber, 'calendarId')))
  const afternoon = await f.service.available(serviceId, barberId, date)
  assert.equal(afternoon.slots[0].startAt, afternoonStart)
  assert.ok(afternoon.slots.every(slot => Date.parse(slot.endAt) - Date.parse(slot.startAt) === 60 * 60_000))
  assert.deepEqual(f.store.booking(receipt.id), existing, 'Changing duration or hours must preserve the existing appointment and its original interval.')

  const closed = payload()
  closed.barbers[0].weeklyHours = closed.barbers[0].weeklyHours.filter(hours => hours.weekday !== 2)
  await f.service.updateCatalog(closed)
  assert.deepEqual((await f.service.available(serviceId, barberId, date)).slots, [])
  const disabled = payload(); disabled.barbers[0].active = false
  await f.service.updateCatalog(disabled)
  assert.equal(f.service.catalog().barbers.some(barber => barber.id === barberId), false)
  await assert.rejects(f.service.available(serviceId, barberId, date), { code: 'INVALID_SERVICE' })
  assert.deepEqual(f.store.booking(receipt.id), existing, 'Disabling a barber must not silently cancel their existing appointments.')

  const reopened = payload()
  reopened.barbers[0].active = true
  reopened.barbers[0].weeklyHours = originalHours
  await f.service.updateCatalog(reopened)
  const restored = await f.service.available(serviceId, barberId, date)
  assert.ok(restored.slots.some(slot => slot.startAt === afternoonStart))
  assert.equal(restored.slots.some(slot => slot.startAt === bookedStart), false, 'The retained appointment must still block its time after reopening.')
  assert.equal(f.service.catalog().barbers.find(barber => barber.id === barberId).name, 'Barbero actualizado')
  assert.equal(f.store.get('catalog').services[0].durationMinutes, 60)
  assert.deepEqual(f.store.booking(receipt.id), existing)
})
