import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { assert, isLocalHost, isLoopback, Problem, GMAIL_SCOPE } from './config.mjs'

const digest = text => createHash('sha256').update(text).digest('hex')
const random = () => randomBytes(32).toString('base64url')
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aa = Buffer.from(a), bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}
export function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split(/=(.*)/s)).filter(parts => parts.length >= 2).map(([key, value]) => [key, value]))
}
export class Auth {
  constructor(config, store, google, { now = Date.now, fetchImpl = fetch } = {}) { this.config = config; this.store = store; this.google = google; this.now = now; this.fetch = fetchImpl }
  cookie(name, value, maxAge) { return `${name}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.config.secureCookies ? '; Secure' : ''}` }
  allowed(user) {
    return Boolean(user?.sub && user.emailVerified && (this.config.adminSub ? user.sub === this.config.adminSub : user.email?.toLowerCase() === this.config.adminEmail))
  }
  localRequest(req) {
    let host, origin
    try {
      host = new URL(`http://${req.headers.host}`).hostname
      origin = req.headers.origin ? new URL(req.headers.origin).hostname : host
    } catch { return false }
    return isLoopback(req.socket.remoteAddress) && isLocalHost(host) && isLocalHost(origin) && isLocalHost(new URL(this.config.origin).hostname)
  }
  origin(req) {
    const origin = req.headers.origin
    if (origin && origin !== this.config.origin) throw new Problem(403, 'ORIGIN_DENIED', 'Origen de solicitud no autorizado.')
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new Problem(403, 'ORIGIN_DENIED', 'Origen de solicitud no autorizado.')
  }
  find(req) {
    const token = cookies(req).em_session
    if (!token || token.length > 128) return null
    const record = this.store.db.prepare('SELECT body,expires FROM sessions WHERE id=?').get(digest(token))
    if (!record || record.expires <= this.now()) return null
    const session = JSON.parse(record.body)
    if (session.mode !== this.config.mode || (session.mode === 'demo' ? !this.localRequest(req) : !this.allowed(session.user))) return null
    return session
  }
  view(req) {
    const session = this.find(req)
    return { authenticated: Boolean(session), mode: this.config.mode, authConfigured: this.config.oauthConfigured && this.config.mode !== 'demo', csrfToken: session?.csrfToken || null, user: session ? { name: session.user.name, email: session.user.email, ...(session.user.picture ? { picture: session.user.picture } : {}) } : null }
  }
  require(req, mutation = false) {
    const session = this.find(req)
    if (!session) throw new Problem(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.')
    if (mutation) { this.origin(req); if (!sameSecret(req.headers['x-csrf-token'], session.csrfToken)) throw new Problem(403, 'CSRF_INVALID', 'Actualiza la sesión y vuelve a intentarlo.') }
    return session
  }
  create(user, res) {
    const token = random(), session = { user, csrfToken: random(), mode: this.config.mode }
    this.store.db.prepare('INSERT INTO sessions(id,expires,body) VALUES(?,?,?)').run(digest(token), this.now() + 8 * 60 * 60 * 1000, JSON.stringify(session))
    this.store.db.prepare('DELETE FROM sessions WHERE expires<?').run(this.now())
    res.setHeader('Set-Cookie', this.cookie('em_session', token, 8 * 60 * 60))
    return session
  }
  demo(req, res) {
    assert(this.config.mode === 'demo' && this.localRequest(req), 'DEMO_DISABLED', 'El acceso de demostración solo existe en el equipo local.', 403)
    this.origin(req)
    const user = { sub: 'local-demo', email: 'demo@localhost.example', emailVerified: true, name: 'Administrador · Demo local' }
    const session = this.create(user, res)
    return { authenticated: true, mode: 'demo', authConfigured: false, csrfToken: session.csrfToken, user: { name: user.name, email: user.email } }
  }
  logout(req, res) {
    this.require(req, true)
    const token = cookies(req).em_session
    this.store.db.prepare('DELETE FROM sessions WHERE id=?').run(digest(token))
    res.setHeader('Set-Cookie', this.cookie('em_session', '', 0))
  }
  start(req, res) {
    assert(this.config.oauthConfigured && this.config.mode !== 'demo', 'AUTH_NOT_CONFIGURED', 'Configura Google OAuth y la identidad administrativa.', 503)
    const state = random(), verifier = random()
    this.store.db.prepare('DELETE FROM oauth WHERE expires<?').run(this.now())
    this.store.db.prepare('INSERT INTO oauth(id,expires,body) VALUES(?,?,?)').run(digest(state), this.now() + 10 * 60 * 1000, JSON.stringify({ verifier }))
    res.setHeader('Set-Cookie', this.cookie('em_oauth', state, 600))
    const params = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope: this.config.scopes.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }
  async callback(req, res, url) {
    assert(this.config.oauthConfigured && this.config.mode !== 'demo', 'AUTH_NOT_CONFIGURED', 'Google OAuth no está configurado.', 503)
    const state = url.searchParams.get('state'), cookie = cookies(req).em_oauth
    assert(state && sameSecret(state, cookie), 'OAUTH_STATE_INVALID', 'La sesión de autorización no es válida.', 403)
    const row = this.store.db.prepare('SELECT * FROM oauth WHERE id=?').get(digest(state))
    this.store.db.prepare('DELETE FROM oauth WHERE id=?').run(digest(state))
    res.setHeader('Set-Cookie', this.cookie('em_oauth', '', 0))
    assert(row && row.expires > this.now(), 'OAUTH_STATE_INVALID', 'La sesión de autorización ha vencido.', 403)
    assert(!url.searchParams.get('error') && url.searchParams.get('code'), 'OAUTH_DENIED', 'No se completó la autorización de Google.', 403)
    const { verifier } = JSON.parse(row.body)
    let response, token, identity
    try {
      response = await this.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri, grant_type: 'authorization_code', code_verifier: verifier }), signal: AbortSignal.timeout(20000) })
      token = await response.json()
      if (!response.ok || !token.access_token) throw new Error('token')
      response = await this.fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(20000) })
      identity = await response.json()
      if (!response.ok || !identity.sub) throw new Error('identity')
    } catch { throw new Problem(502, 'OAUTH_EXCHANGE_FAILED', 'No se pudo verificar la autorización de Google.') }
    const user = { sub: identity.sub, name: String(identity.name || identity.email || '').slice(0, 160), email: String(identity.email || '').toLowerCase(), emailVerified: identity.email_verified === true, picture: typeof identity.picture === 'string' && identity.picture.startsWith('https:') ? identity.picture : undefined }
    assert(this.allowed(user), 'ADMIN_NOT_ALLOWED', 'Esta cuenta no tiene acceso administrativo.', 403)
    const granted = String(token.scope || '').split(' ')
    assert(granted.includes('https://www.googleapis.com/auth/calendar.events') || granted.includes('https://www.googleapis.com/auth/calendar'), 'GOOGLE_SCOPE_MISSING', 'Falta el permiso requerido de Google Calendar.', 403)
    if (this.config.emailEnabled) assert(granted.includes(GMAIL_SCOPE), 'GOOGLE_SCOPE_MISSING', 'Falta el permiso de envío de Gmail.', 403)
    const previous = this.google.tokens()
    const refreshToken = token.refresh_token || (previous?.sub === user.sub ? previous.refresh_token : null)
    assert(refreshToken, 'GOOGLE_OFFLINE_ACCESS_REQUIRED', 'Autoriza el acceso sin conexión a la cuenta de Google.', 403)
    this.google.saveTokens({ ...token, refresh_token: refreshToken, sub: user.sub, email: user.email, expiresAt: this.now() + Number(token.expires_in || 3600) * 1000 })
    this.create(user, res)
    this.store.audit('google.connected', null, 'Cuenta administrativa autorizada; credenciales cifradas.', this.now())
  }
}
