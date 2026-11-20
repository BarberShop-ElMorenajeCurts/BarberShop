// HTTP integration check. Refuses to mutate anything outside explicit demo mode.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.SMOKE_ORIGIN || 'http://localhost:3001'
const origin = process.env.SMOKE_APP_ORIGIN || 'http://localhost:8443'
let cookie = ''
let csrf = ''

async function call(path, method = 'GET', body, expected = 200) {
  const headers = { Origin: origin, Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  if (csrf) headers['X-CSRF-Token'] = csrf
  const response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const setCookie = response.headers.getSetCookie()
  if (setCookie.length) cookie = setCookie.map(value => value.split(';')[0]).join('; ')
  const data = response.status === 204 ? null : await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`)
  return data
}

const session = await call('/api/session')
assert.equal(session.mode, 'demo', 'This check only runs against the isolated demo database.')
assert.equal(session.authenticated, false, 'The check must start without a session.')
const logged = await call('/api/auth/demo', 'POST')
assert.equal(logged.authenticated, true)
csrf = logged.csrfToken
assert.ok(csrf)

const catalog = await call('/api/catalog')
assert.equal(catalog.mode, 'demo')
assert.equal(catalog.bookingEnabled, true)
assert.ok(catalog.services.length)
assert.ok(catalog.barbers.length)
assert.equal('calendarId' in catalog.barbers[0], false, 'Public catalog must not expose private calendar IDs.')
const overview = await call('/api/admin/overview')
assert.ok(Array.isArray(overview.audit))
assert.ok(overview.catalog.barbers[0].calendarId)
const catalogInput = { expectedRevision: overview.catalog.revision, settings: overview.catalog.settings, services: overview.catalog.services, barbers: overview.catalog.barbers }
const editedCatalog = structuredClone(catalogInput)
editedCatalog.barbers[0].name += ' · prueba'
const savedCatalog = await call('/api/admin/catalog', 'PUT', editedCatalog)
assert.notEqual(savedCatalog.revision, catalogInput.expectedRevision)
assert.equal((await call('/api/catalog')).barbers[0].name, editedCatalog.barbers[0].name)
await call('/api/admin/catalog', 'PUT', catalogInput, 409)
await call('/api/admin/catalog', 'PUT', { ...catalogInput, expectedRevision: savedCatalog.revision })

const service = catalog.services.find(s => s.active)
const barber = catalog.barbers.find(b => b.active && b.serviceIds.includes(service.id))
assert.ok(barber)
let chosen
for (let days = 1; days <= 7 && !chosen; days++) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: catalog.settings.timeZone }).format(new Date(Date.now() + days * 86400000))
  const availability = await call(`/api/availability?${new URLSearchParams({ serviceId: service.id, barberId: barber.id, date })}`)
  assert.equal(availability.timeZone, catalog.settings.timeZone)
  if (availability.slots.length) chosen = availability.slots[0]
}
assert.ok(chosen, 'No demo slot in the next seven days.')

const input = {
  serviceId: service.id, barberId: barber.id, startAt: chosen.startAt,
  customer: { name: 'Prueba de integración', email: 'smoke@example.invalid', phone: '+59991234567' },
  language: 'es', idempotencyKey: randomUUID(),
}
const receipt = await call('/api/bookings', 'POST', input, 201)
assert.equal(receipt.status, 'pending')
assert.equal(receipt.syncStatus, 'synced')
assert.equal(receipt.mode, 'demo')
assert.ok(Date.parse(receipt.autoConfirmAt) > Date.now())
const repeated = await call('/api/bookings', 'POST', input, 201)
assert.equal(repeated.id, receipt.id)
await call('/api/bookings', 'POST', { ...input, idempotencyKey: randomUUID() }, 409)

const current = (await call('/api/admin/overview')).bookings.find(b => b.id === receipt.id)
assert.ok(current)
const approved = await call(`/api/admin/bookings/${receipt.id}/action`, 'POST', { action: 'approve', expectedVersion: current.version })
assert.equal(approved.status, 'confirmed')
assert.equal(approved.confirmationSource, 'manual')
await call(`/api/admin/bookings/${receipt.id}/action`, 'POST', { action: 'reject', expectedVersion: current.version }, 409)
const cancelled = await call(`/api/admin/bookings/${receipt.id}/action`, 'POST', { action: 'cancel', expectedVersion: approved.version })
assert.equal(cancelled.status, 'cancelled')

const block = await call('/api/admin/blocks', 'POST', { barberId: barber.id, startAt: chosen.startAt, endAt: chosen.endAt, reason: 'Prueba de integración' }, 201)
assert.ok(block.id)
await call('/api/admin/blocks/' + block.id, 'DELETE', undefined, 204)

const photo = await call('/api/admin/photos', 'POST', {
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvGkAAAAASUVORK5CYII=',
  section: 'gallery', alt: { es: 'Imagen de prueba', en: 'Test image' }, sortOrder: 999,
}, 201)
assert.ok(photo.url.startsWith('/media/'))
const imageResponse = await fetch(new URL(photo.url, base))
assert.equal(imageResponse.status, 200)
assert.ok(imageResponse.headers.get('content-type').includes('image/png'))
const updated = await call('/api/admin/photos/' + photo.id, 'PATCH', { alt: { es: 'Prueba actualizada', en: 'Updated test' }, sortOrder: 998 })
assert.equal(updated.alt.en, 'Updated test')
const replaced = await call('/api/admin/photos/' + photo.id, 'PATCH', { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvGkAAAAASUVORK5CYII=' })
assert.equal(replaced.id, photo.id)
assert.equal(replaced.alt.en, updated.alt.en)
assert.equal(replaced.sortOrder, updated.sortOrder)
assert.notEqual(replaced.url, photo.url)
assert.equal((await fetch(new URL(photo.url, base))).status, 404)
assert.equal((await fetch(new URL(replaced.url, base))).status, 200)
await call('/api/admin/photos/' + photo.id, 'DELETE', undefined, 204)
await call('/api/auth/logout', 'POST', undefined, 204)
await call('/api/admin/overview', 'GET', undefined, 401)
console.log('HTTP smoke passed: contract, local session, CSRF, availability, idempotency, conflicts, approval, cancellation, blocks, images and logout.')
