import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { GMAIL_SCOPE, Problem, TIME_ZONE } from './config.mjs'

export class GoogleError extends Error {
  constructor(status, code, retryAfter = 0) { super('La operación de Google no pudo completarse.'); this.status = status; this.code = code; this.retryAfter = retryAfter }
}
export function encrypt(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}
export function decrypt(value, key) {
  const data = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'))
}
const stableId = id => `em${createHash('sha256').update(id).digest('hex').slice(0, 48)}`
const encoded = value => encodeURIComponent(value)
const eventPath = (calendar, id = '') => `/calendar/v3/calendars/${encoded(calendar)}/events${id ? `/${encoded(id)}` : ''}`

export class GoogleAdapter {
  constructor(config, store, { fetchImpl = fetch, now = Date.now } = {}) { this.config = config; this.store = store; this.fetch = fetchImpl; this.now = now; this.refreshing = null }
  tokens() {
    const saved = this.store.get('google.tokens')
    if (!saved || !this.config.encryptionKey) return null
    try {
      const tokens = decrypt(saved, this.config.encryptionKey)
      // Changing the server allowlist must also disconnect the previous owner's
      // offline credentials, not merely invalidate their browser sessions.
      const ownerMatches = tokens.sub && (this.config.adminSub ? tokens.sub === this.config.adminSub : this.config.adminEmail && tokens.email?.toLowerCase() === this.config.adminEmail)
      return ownerMatches ? tokens : null
    } catch { return null }
  }
  saveTokens(tokens) { this.store.set('google.tokens', encrypt(tokens, this.config.encryptionKey)) }
  connected() { return Boolean(this.tokens()?.refresh_token) }
  emailConfigured() { return this.config.emailEnabled && this.connected() && (this.tokens()?.scope || '').split(' ').includes(GMAIL_SCOPE) }
  async accessToken() {
    const tokens = this.tokens()
    if (!tokens?.refresh_token) throw new Problem(503, 'GOOGLE_NOT_CONNECTED', 'Conecta la cuenta de Google del negocio.')
    if (tokens.access_token && tokens.expiresAt > this.now() + 60000) return tokens.access_token
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const response = await this.fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.access_token) throw new GoogleError(response.status, 'GOOGLE_AUTH_ERROR')
      this.saveTokens({ ...tokens, ...data, expiresAt: this.now() + Number(data.expires_in || 3600) * 1000 })
      return data.access_token
    })()
    try { return await this.refreshing } finally { this.refreshing = null }
  }
  async request(path, { method = 'GET', body, headers = {}, allow404 = false, retried = false } = {}) {
    const accessToken = await this.accessToken()
    let response
    try {
      response = await this.fetch(`https://www.googleapis.com${path}`, { method, headers: { authorization: `Bearer ${accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
    } catch { throw new GoogleError(0, 'GOOGLE_NETWORK_ERROR') }
    if (response.status === 401 && !retried) {
      const tokens = this.tokens(); if (tokens) this.saveTokens({ ...tokens, expiresAt: 0 })
      return this.request(path, { method, body, headers, allow404, retried: true })
    }
    if (response.status === 404 && allow404) return null
    if (!response.ok) throw new GoogleError(response.status, response.status === 410 ? 'GOOGLE_SYNC_TOKEN_EXPIRED' : response.status === 412 ? 'GOOGLE_CONCURRENT_CHANGE' : response.status === 429 ? 'GOOGLE_QUOTA' : 'GOOGLE_API_ERROR', Number(response.headers.get('retry-after') || 0) * 1000)
    if (response.status === 204) return null
    return response.json()
  }
  async calendarExists(calendarId) {
    // events.list validates read/write scope and access without requiring CalendarList scope.
    await this.request(`${eventPath(calendarId)}?maxResults=1`)
  }
  async listChanges(calendarId, syncToken = null) {
    let nextPage = null, nextToken = null, events = []
    do {
      const params = new URLSearchParams({ maxResults: '2500', showDeleted: 'true', singleEvents: 'false' })
      if (syncToken) params.set('syncToken', syncToken)
      if (nextPage) params.set('pageToken', nextPage)
      const page = await this.request(`${eventPath(calendarId)}?${params}`)
      events.push(...(page.items || [])); nextPage = page.nextPageToken; nextToken = page.nextSyncToken || nextToken
    } while (nextPage)
    return { events, nextSyncToken: nextToken }
  }
  async busy(calendarId, start, end) {
    let pageToken = null, events = []
    do {
      const params = new URLSearchParams({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), singleEvents: 'true', showDeleted: 'false', maxResults: '2500' })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await this.request(`${eventPath(calendarId)}?${params}`)
      events.push(...(page.items || []).filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent')); pageToken = page.nextPageToken
    } while (pageToken)
    return events
  }
  async getEvent(calendarId, eventId) { return this.request(eventPath(calendarId, eventId), { allow404: true }) }
  async findLinked(calendarId, bookingId) {
    const query = new URLSearchParams({ privateExtendedProperty: `bookingId=${bookingId}`, showDeleted: 'false', maxResults: '2500' })
    return (await this.request(`${eventPath(calendarId)}?${query}`)).items || []
  }
  async upsert(booking, calendarId, serviceName, confirmed = false) {
    const id = booking.googleEventId || stableId(booking.id)
    const existing = await this.getEvent(calendarId, id)
    if (existing?.status === 'cancelled') throw new GoogleError(409, 'GOOGLE_EVENT_DELETED')
    if (existing && existing.extendedProperties?.private?.bookingId !== booking.id) throw new GoogleError(409, 'GOOGLE_EVENT_COLLISION')
    const en = booking.language === 'en'
    const deadline = booking.autoConfirmAt ? new Intl.DateTimeFormat(en ? 'en-GB' : 'es', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date(booking.autoConfirmAt)) : en ? 'when the request is registered' : 'al registrarse la solicitud'
    const body = {
      summary: `${confirmed ? (en ? 'CONFIRMED' : 'CONFIRMADA') : (en ? 'PENDING' : 'PENDIENTE')} · ${serviceName} · ${booking.customer.name}`,
      description: en ? `${confirmed ? 'Appointment confirmed.' : `Automatically confirms ${deadline} (${TIME_ZONE}) unless declined in the portal.`}\nPhone: ${booking.customer.phone}\nBooking: ${booking.id}\nTo decline a pending request from Calendar, delete the event.` : `${confirmed ? 'Cita confirmada.' : `Se confirma automáticamente ${deadline} (${TIME_ZONE}) si no se rechaza desde el portal.`}\nTeléfono: ${booking.customer.phone}\nReserva: ${booking.id}\nPara rechazar una pendiente desde Calendar, elimina el evento.`,
      start: { dateTime: booking.startAt, timeZone: TIME_ZONE }, end: { dateTime: booking.endAt, timeZone: TIME_ZONE },
      transparency: 'opaque', status: 'confirmed',
      extendedProperties: { private: { bookingId: booking.id, revision: String(booking.version), app: 'elmorenaje' } },
      attendees: confirmed ? [{ email: booking.customer.email, displayName: booking.customer.name }] : [],
      reminders: { useDefault: false },
    }
    const matchesPayload = event => event?.status === body.status && event.transparency === body.transparency && event.summary === body.summary && event.description === body.description && Date.parse(event.start?.dateTime) === Date.parse(body.start.dateTime) && Date.parse(event.end?.dateTime) === Date.parse(body.end.dateTime) && event.extendedProperties?.private?.bookingId === booking.id && event.extendedProperties?.private?.revision === String(booking.version) && event.extendedProperties?.private?.app === 'elmorenaje' && event.reminders?.useDefault === false && JSON.stringify((event.attendees || []).map(a => ({ email: a.email, displayName: a.displayName || '' })).sort((a, b) => a.email.localeCompare(b.email))) === JSON.stringify(body.attendees.map(a => ({ email: a.email, displayName: a.displayName || '' })).sort((a, b) => a.email.localeCompare(b.email)))
    if (existing && (!booking.googleEtag || existing.etag !== booking.googleEtag)) {
      if (matchesPayload(existing)) return existing
      throw new GoogleError(412, 'GOOGLE_CONCURRENT_CHANGE')
    }
    const query = `?sendUpdates=${confirmed ? 'all' : 'none'}`
    if (existing) return this.request(`${eventPath(calendarId, id)}${query}`, { method: 'PATCH', body, headers: existing.etag ? { 'if-match': existing.etag } : {} })
    try { return await this.request(`${eventPath(calendarId)}${query}`, { method: 'POST', body: { id, ...body } }) }
    catch (error) {
      // Stable IDs let a retry recover an insert whose response was lost.
      if (error.status === 409 || error.status === 0) {
        const recovered = await this.getEvent(calendarId, id)
        if (matchesPayload(recovered)) return recovered
        if (recovered) throw new GoogleError(412, 'GOOGLE_CONCURRENT_CHANGE')
      }
      throw error
    }
  }
  async move(booking, destination) {
    if (booking.googleCalendarId === destination) return this.getEvent(destination, booking.googleEventId)
    const params = new URLSearchParams({ destination, sendUpdates: booking.status === 'confirmed' ? 'all' : 'none' })
    try { return await this.request(`${eventPath(booking.googleCalendarId, booking.googleEventId)}/move?${params}`, { method: 'POST' }) }
    catch (error) {
      const recovered = await this.findLinked(destination, booking.id)
      if (recovered.length === 1) return recovered[0]
      throw error
    }
  }
  async remove(booking) {
    if (!booking.googleEventId || !booking.googleCalendarId) return
    try { await this.request(`${eventPath(booking.googleCalendarId, booking.googleEventId)}?sendUpdates=${booking.hadInvite ? 'all' : 'none'}`, { method: 'DELETE', allow404: true }) }
    catch (error) { if (error.status !== 410) throw error }
  }
  async sendEmail({ to, subject, text, messageId }) {
    if (!this.emailConfigured()) throw new Problem(503, 'EMAIL_NOT_CONFIGURED', 'El envío de correo requiere autorización de Gmail.')
    const tokens = this.tokens()
    if (![to, tokens.email].every(v => typeof v === 'string' && /^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/.test(v))) throw new Error('Dirección de correo no válida')
    const mime = [
      `From: ${tokens.email}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      `Message-ID: <${createHash('sha256').update(messageId).digest('hex')}@elmorenaje.local>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
      Buffer.from(text).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '',
    ].join('\r\n')
    return this.request('/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw: Buffer.from(mime).toString('base64url') } })
  }
}

// Explicit isolated demo. This adapter never calls a network service.
export class DemoAdapter {
  constructor(store) { this.store = store }
  connected() { return true }
  emailConfigured() { return true }
  async busy(calendarId, start, end) { return this.store.events(calendarId).filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent' && Date.parse(e.start?.dateTime) < end && Date.parse(e.end?.dateTime) > start) }
  async calendarExists() {}
  async getEvent(calendarId, id) { return this.store.events(calendarId).find(e => e.id === id) || null }
  async upsert(b, calendarId, name, confirmed) {
    const en = b.language === 'en'
    const event = { id: b.googleEventId || stableId(b.id), etag: `demo-${b.version}-${confirmed}`, status: 'confirmed', start: { dateTime: b.startAt }, end: { dateTime: b.endAt }, summary: `${confirmed ? (en ? 'CONFIRMED' : 'CONFIRMADA') : (en ? 'PENDING' : 'PENDIENTE')} · ${name}`, extendedProperties: { private: { bookingId: b.id, revision: String(b.version) } }, attendees: confirmed ? [{ email: b.customer.email }] : [] }
    this.store.saveEvent(calendarId, event); return event
  }
  async remove(b) { const event = await this.getEvent(b.googleCalendarId, b.googleEventId); if (event) this.store.saveEvent(b.googleCalendarId, { ...event, status: 'cancelled' }) }
  async move(b, destination) { const event = await this.getEvent(b.googleCalendarId, b.googleEventId); await this.remove(b); this.store.saveEvent(destination, { ...event, status: 'confirmed' }); return event }
  async listChanges(calendarId) { return { events: this.store.events(calendarId), nextSyncToken: 'demo' } }
  async findLinked(calendarId, id) { return this.store.events(calendarId).filter(e => e.status !== 'cancelled' && e.extendedProperties?.private?.bookingId === id) }
  async sendEmail() { return { id: 'demo-no-email-sent' } }
}
