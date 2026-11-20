import { createHash } from 'node:crypto'
import { assert, DAY, TIME_ZONE } from './config.mjs'

export const text = (value, max = 500, empty = false) => {
  assert(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
  return value.trim()
}
export function localized(value, max = 500, empty = false) { assert(value && typeof value === 'object'); return { es: text(value.es, max, empty), en: text(value.en, max, empty) } }
export function instant(value) {
  assert(typeof value === 'string' && value.length < 50 && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'INVALID_DATE', 'La fecha debe incluir zona horaria.')
  const result = Date.parse(value); assert(Number.isFinite(result), 'INVALID_DATE', 'Fecha no válida.'); return result
}
export const iso = value => new Date(value).toISOString()
export const inputHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function customer(value) {
  assert(value && typeof value === 'object')
  const c = { name: text(value.name, 120), email: text(value.email, 254).toLowerCase(), phone: text(value.phone, 40) }
  assert(/^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/.test(c.email), 'INVALID_CUSTOMER', 'Introduce un correo válido.')
  assert(/^[+\d][\d\s().-]{5,39}$/.test(c.phone) && c.phone.replace(/\D/g, '').length >= 7, 'INVALID_CUSTOMER', 'Introduce un teléfono válido.')
  return c
}
export function bookingInput(input, manual = false) {
  assert(input && typeof input === 'object')
  const value = { serviceId: text(input.serviceId, 80), barberId: text(input.barberId, 80), startAt: iso(instant(input.startAt)), customer: customer(input.customer), language: input.language, idempotencyKey: text(input.idempotencyKey, 128) }
  assert(['es', 'en'].includes(value.language))
  assert(/^[a-zA-Z0-9_-]{12,128}$/.test(value.idempotencyKey), 'INVALID_IDEMPOTENCY_KEY', 'La solicitud requiere un identificador válido.')
  if (manual) { assert(['pending', 'confirmed'].includes(input.status)); value.status = input.status }
  return value
}
export function localDay(date) {
  assert(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date), 'INVALID_DATE', 'Usa una fecha YYYY-MM-DD.')
  const ms = Date.parse(`${date}T00:00:00-04:00`)
  assert(Number.isFinite(ms) && new Date(ms - 4 * 3600000).toISOString().slice(0, 10) === date, 'INVALID_DATE', 'Fecha no válida.')
  return ms
}
export const localDate = timestamp => new Date(timestamp - 4 * 3600000).toISOString().slice(0, 10)
export function windowFor(date, hours) {
  const day = localDay(date)
  return hours.filter(h => h.weekday === new Date(day - 4 * 3600000).getUTCDay()).map(h => ({ start: Date.parse(`${date}T${h.start}:00-04:00`), end: Date.parse(`${date}T${h.end}:00-04:00`) }))
}
export function withinHours(start, end, hours) {
  return windowFor(localDate(start), hours).some(w => start >= w.start && end <= w.end && (start - w.start) % (15 * 60000) === 0)
}
function url(value, protocols = ['https:']) {
  const v = text(value, 1000, true)
  if (v) { let parsed; try { parsed = new URL(v) } catch { assert(false) }; assert(protocols.includes(parsed.protocol) && !parsed.username && !parsed.password) }
  return v
}
export function catalogInput(input) {
  assert(input?.settings && Array.isArray(input.services) && input.services.length <= 100 && Array.isArray(input.barbers) && input.barbers.length <= 25)
  const s = input.settings
  assert(s.timeZone === TIME_ZONE, 'INVALID_TIME_ZONE', `El negocio usa ${TIME_ZONE}.`)
  assert(typeof s.businessDataConfirmed === 'boolean')
  const settings = { name: text(s.name, 120), timeZone: TIME_ZONE, whatsapp: text(s.whatsapp, 30, true), instagram: url(s.instagram), tiktok: url(s.tiktok), facebook: url(s.facebook ?? ''), address: localized(s.address, 500, true), mapsUrl: url(s.mapsUrl), businessDataConfirmed: s.businessDataConfirmed }
  assert(!settings.whatsapp || /^\+?\d{7,20}$/.test(settings.whatsapp), 'INVALID_CONTACT', 'WhatsApp debe contener el número internacional.')
  const services = input.services.map(service => {
    const value = { id: text(service.id, 80), name: localized(service.name, 120), description: localized(service.description, 1000, true), durationMinutes: service.durationMinutes, price: service.price, currency: service.currency, accent: service.accent, active: service.active }
    assert(/^[a-zA-Z0-9_-]+$/.test(value.id) && (value.durationMinutes === null || (Number.isInteger(value.durationMinutes) && value.durationMinutes >= 5 && value.durationMinutes <= 480)))
    assert(value.price === null || (Number.isFinite(value.price) && value.price >= 0 && value.price <= 1e7))
    assert(value.currency === null || (typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)))
    assert(['yellow', 'red', 'blue'].includes(value.accent) && typeof value.active === 'boolean')
    return value
  })
  assert(new Set(services.map(v => v.id)).size === services.length)
  const barbers = input.barbers.map(barber => {
    assert(Array.isArray(barber.serviceIds) && barber.serviceIds.length <= 100 && Array.isArray(barber.weeklyHours) && barber.weeklyHours.length <= 42)
    const value = { id: text(barber.id, 80), name: text(barber.name, 120), specialty: localized(barber.specialty, 300, true), serviceIds: [...new Set(barber.serviceIds.map(id => text(id, 80)))], active: barber.active, calendarId: text(barber.calendarId, 500, true), weeklyHours: barber.weeklyHours.map(h => ({ weekday: h.weekday, start: text(h.start, 5), end: text(h.end, 5) })) }
    assert(/^[a-zA-Z0-9_-]+$/.test(value.id) && typeof value.active === 'boolean' && value.serviceIds.every(id => services.some(service => service.id === id)))
    for (const h of value.weeklyHours) assert(Number.isInteger(h.weekday) && h.weekday >= 0 && h.weekday <= 6 && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.end) && h.start < h.end)
    for (let i = 0; i < value.weeklyHours.length; i++) for (let j = i + 1; j < value.weeklyHours.length; j++) {
      const a = value.weeklyHours[i], b = value.weeklyHours[j]
      assert(a.weekday !== b.weekday || a.start >= b.end || a.end <= b.start, 'OVERLAPPING_HOURS', 'Los horarios de trabajo no pueden superponerse.')
    }
    return value
  })
  assert(new Set(barbers.map(v => v.id)).size === barbers.length)
  const calendars = barbers.filter(b => b.calendarId).map(b => b.calendarId)
  assert(new Set(calendars).size === calendars.length, 'DUPLICATE_CALENDAR', 'Cada barbero necesita un calendario distinto.')
  return { settings, services, barbers }
}
export const publicBooking = b => ({ id: b.id, status: b.status, syncStatus: b.syncStatus, startAt: b.startAt, endAt: b.endAt, autoConfirmAt: b.autoConfirmAt, mode: b.mode })
export const adminBooking = b => ({ ...publicBooking(b), serviceId: b.serviceId, barberId: b.barberId, customer: b.customer, language: b.language, createdAt: b.createdAt, confirmationSource: b.confirmationSource, version: b.version, syncError: b.syncError })
export function eventInterval(event) {
  const start = event.start?.dateTime ? Date.parse(event.start.dateTime) : event.start?.date ? localDay(event.start.date) : NaN
  const end = event.end?.dateTime ? Date.parse(event.end.dateTime) : event.end?.date ? localDay(event.end.date) : NaN
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null
}
export function validateHorizon(start, now) { assert(start < now + 180 * DAY, 'DATE_TOO_FAR', 'La agenda online permite reservar hasta 180 días antes.') }
