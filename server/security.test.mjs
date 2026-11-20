import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadConfig, GMAIL_SCOPE } from './config.mjs'
import { Store } from './store.mjs'
import { GoogleAdapter, GoogleError } from './google.mjs'
import { Auth, sameSecret } from './auth.mjs'
import { createApplication } from './http.mjs'

function fixture(t, env = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'barber-security-test-'))
  const config = loadConfig({ APP_MODE: 'live', APP_ORIGIN: 'http://localhost:8443', DATA_DIR: directory, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', ADMIN_GOOGLE_SUB: 'owner-sub', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), EMAIL_ENABLED: 'true', ...env })
  const store = new Store(config.dataDir, { demo: config.mode === 'demo' })
  t.after(() => { store.close(); if (path.dirname(directory) === os.tmpdir()) rmSync(directory, { recursive: true, force: true }) })
  return { config, store }
}
const userTokens = { sub: 'owner-sub', email: 'owner@example.com', scope: `openid https://www.googleapis.com/auth/calendar.events ${GMAIL_SCOPE}`, refresh_token: 'test-refresh', access_token: 'test-access', expiresAt: 9e12 }
const request = (options = {}) => ({ headers: { host: 'localhost:8443', ...options.headers }, socket: { remoteAddress: options.remoteAddress || '127.0.0.1' } })
const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value } })

test('constant-time comparison handles different UTF-8 byte lengths without throwing', () => {
  assert.equal(sameSecret('é', 'a'), false); assert.equal(sameSecret('😀', 'aa'), false)
  assert.equal(sameSecret('é', 'é'), true); assert.equal(sameSecret(undefined, ''), false)
})

test('offline Google tokens are bound to the current administrative allowlist', async t => {
  const f = fixture(t), google = new GoogleAdapter(f.config, f.store, { fetchImpl: async () => { throw new Error('Network must not be called') } })
  google.saveTokens(userTokens)
  assert.equal(google.connected(), true)
  f.config.adminSub = 'new-owner'
  assert.equal(google.tokens(), null); assert.equal(google.connected(), false); assert.equal(google.emailConfigured(), false)
  await assert.rejects(google.accessToken(), { code: 'GOOGLE_NOT_CONNECTED' })
  f.config.adminSub = ''; f.config.adminEmail = 'owner@example.com'; assert.equal(google.connected(), true)
  f.config.adminEmail = 'new@example.com'; assert.equal(google.connected(), false)
})

test('OAuth uses state, PKCE, verified identity and offline scopes without leaking tokens to session', async t => {
  const f = fixture(t), calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify(url.includes('/token') ? { ...userTokens, expires_in: 3600 } : { sub: 'owner-sub', email: 'owner@example.com', email_verified: true, name: 'Owner' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const google = new GoogleAdapter(f.config, f.store, { fetchImpl }), auth = new Auth(f.config, f.store, google, { fetchImpl }), res = response()
  const start = new URL(auth.start(request(), res)), state = start.searchParams.get('state'), oauthCookie = res.headers['set-cookie'].split(';')[0]
  assert.equal(start.searchParams.get('code_challenge_method'), 'S256'); assert.equal(start.searchParams.get('access_type'), 'offline')
  assert.ok(start.searchParams.get('scope').includes(GMAIL_SCOPE)); assert.ok(start.searchParams.get('code_challenge'))
  const callback = new URL(`/api/auth/google/callback?state=${state}&code=test-code`, f.config.origin)
  await auth.callback(request({ headers: { cookie: oauthCookie } }), res, callback)
  assert.ok(new URLSearchParams(calls[0].options.body).get('code_verifier'))
  assert.equal(google.connected(), true)
  const session = auth.view(request({ headers: { cookie: res.headers['set-cookie'].split(';')[0] } }))
  assert.equal(session.authenticated, true); assert.ok(session.csrfToken)
  assert.ok(!JSON.stringify(session).includes('test-refresh')); assert.ok(!f.store.get('google.tokens').includes('test-refresh'))
  await assert.rejects(auth.callback(request({ headers: { cookie: oauthCookie } }), response(), callback), { code: 'OAUTH_STATE_INVALID' })
})

test('OAuth refuses missing state, other accounts, and missing Gmail authorization', async t => {
  const f = fixture(t)
  let other = true
  const fetchImpl = async url => new Response(JSON.stringify(url.includes('/token') ? { ...userTokens, scope: 'openid https://www.googleapis.com/auth/calendar.events' } : { sub: other ? 'someone-else' : 'owner-sub', email: 'owner@example.com', email_verified: true }), { status: 200 })
  const google = new GoogleAdapter(f.config, f.store, { fetchImpl }), auth = new Auth(f.config, f.store, google, { fetchImpl })
  await assert.rejects(auth.callback(request(), response(), new URL('/api/auth/google/callback?code=x', f.config.origin)), { code: 'OAUTH_STATE_INVALID' })
  for (const expected of ['ADMIN_NOT_ALLOWED', 'GOOGLE_SCOPE_MISSING']) {
    const res = response(), url = new URL(auth.start(request(), res)), cookie = res.headers['set-cookie'].split(';')[0]
    await assert.rejects(auth.callback(request({ headers: { cookie } }), response(), new URL(`/api/auth/google/callback?state=${url.searchParams.get('state')}&code=x`, f.config.origin)), { code: expected })
    other = false
  }
  assert.equal(google.connected(), false)
})

test('demo login rejects remote addresses, public Host or Origin, proxy headers, and production mode', t => {
  const f = fixture(t, { APP_MODE: 'demo' }), auth = new Auth(f.config, f.store, {})
  const bad = [request({ remoteAddress: '203.0.113.4', headers: { 'x-forwarded-for': '127.0.0.1' } }), request({ headers: { host: 'public.example' } }), request({ headers: { origin: 'https://public.example' } }), request({ headers: { origin: 'http://127.0.0.1:8443' } })]
  for (const req of bad) assert.throws(() => auth.demo(req, response()), error => ['DEMO_DISABLED', 'ORIGIN_DENIED'].includes(error.code))
  assert.equal(auth.demo(request({ headers: { origin: f.config.origin } }), response()).authenticated, true)
  f.config.mode = 'live'; assert.throws(() => auth.demo(request(), response()), { code: 'DEMO_DISABLED' })
})

test('administrator sessions expire and changed allowlists invalidate existing sessions', t => {
  const f = fixture(t), google = new GoogleAdapter(f.config, f.store)
  let now = 1000
  const auth = new Auth(f.config, f.store, google, { now: () => now }), res = response()
  auth.create({ sub: 'owner-sub', emailVerified: true, email: 'owner@example.com', name: 'Owner' }, res)
  const req = request({ headers: { cookie: res.headers['set-cookie'].split(';')[0] } })
  assert.equal(auth.view(req).authenticated, true)
  f.config.adminSub = 'other'; assert.equal(auth.view(req).authenticated, false)
  f.config.adminSub = 'owner-sub'; now += 8 * 3600000 + 1
  assert.equal(auth.view(req).authenticated, false)
})

test('HTTP protects administrator data with session and CSRF; cookies expire and logout invalidates', async t => {
  const f = fixture(t, { APP_MODE: 'demo' }), app = createApplication(f.config, { store: f.store })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await app.close() })
  const base = `http://127.0.0.1:${app.server.address().port}`
  const publicResponse = await fetch(`${base}/api/catalog`); const catalog = await publicResponse.json()
  assert.equal(catalog.mode, 'demo'); assert.ok(!JSON.stringify(catalog).includes('calendarId'))
  assert.equal((await fetch(`${base}/api/admin/overview`)).status, 401)
  assert.equal((await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403)
  const login = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { origin: f.config.origin } }), session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0]
  assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /SameSite=Lax/)
  const overview = await fetch(`${base}/api/admin/overview`, { headers: { cookie } }); assert.equal(overview.status, 200)
  const value = await overview.json(), payload = { expectedRevision: value.catalog.revision, settings: value.catalog.settings, services: value.catalog.services, barbers: value.catalog.barbers }
  assert.equal((await fetch(`${base}/api/admin/catalog`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 403)
  assert.equal((await fetch(`${base}/api/admin/catalog`, { method: 'PUT', headers: { cookie, origin: f.config.origin, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 200)
  assert.equal((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie, origin: f.config.origin, 'x-csrf-token': session.csrfToken } })).status, 204)
  assert.equal((await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).status, 401)
})

test('Google insert recovery accepts only an identical owned payload and never patches an external edit', async t => {
  const f = fixture(t), google = new GoogleAdapter(f.config, f.store), booking = { id: 'test-booking', version: 1, language: 'en', customer: { name: 'Test', email: 'client@example.com', phone: '+59991234567' }, startAt: '2026-11-16T16:00:00Z', endAt: '2026-11-16T16:45:00Z', autoConfirmAt: '2026-11-16T14:00:00Z' }
  let saved, gets = 0, patches = 0, alter = false
  google.getEvent = async () => { gets++; return gets === 1 ? null : alter ? { ...saved, etag: 'external', start: { dateTime: '2026-11-17T16:00:00Z' } } : saved }
  google.request = async (url, options) => { if (options.method === 'PATCH') patches++; saved = { ...options.body, etag: 'inserted' }; throw new GoogleError(409, 'GOOGLE_API_ERROR') }
  const recovered = await google.upsert(booking, 'calendar', 'Classic Fade', true)
  assert.match(recovered.summary, /^CONFIRMED/); assert.match(recovered.description, /^Appointment confirmed/); assert.equal(patches, 0)
  gets = 0; alter = true
  await assert.rejects(google.upsert(booking, 'calendar', 'Classic Fade', true), { code: 'GOOGLE_CONCURRENT_CHANGE' })
  assert.equal(patches, 0)
  gets = 0; alter = false
  google.getEvent = async () => ({ ...saved, extendedProperties: { private: { ...saved.extendedProperties.private, revision: '99' } } })
  await assert.rejects(google.upsert(booking, 'calendar', 'Classic Fade', true), { code: 'GOOGLE_CONCURRENT_CHANGE' })
})

test('restart marks in-flight email uncertain while retrying idempotent Calendar work', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'barber-restart-test-'))
  let store = new Store(directory, { demo: true })
  store.job('mail-running', 'email', null, 1, {})
  store.job('reminder-running', 'reminder', null, 1, {})
  store.job('hold-running', 'hold', null, 1, {})
  store.db.prepare("UPDATE jobs SET state='running'").run(); store.close()
  store = new Store(directory, { demo: true })
  t.after(() => { store.close(); if (path.dirname(directory) === os.tmpdir()) rmSync(directory, { recursive: true, force: true }) })
  const rows = Object.fromEntries(store.db.prepare('SELECT id,state FROM jobs').all().map(row => [row.id, row.state]))
  assert.equal(rows['mail-running'], 'uncertain'); assert.equal(rows['reminder-running'], 'uncertain'); assert.equal(rows['hold-running'], 'pending')
})
