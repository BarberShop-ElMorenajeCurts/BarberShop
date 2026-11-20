import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { checkConfiguration, formatReport, runPreflight } from '../preflight.mjs'

const complete = overrides => ({ APP_MODE: 'live', APP_ORIGIN: 'https://barber.example', GOOGLE_REDIRECT_URI: 'https://barber.example/api/auth/google/callback', GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), ADMIN_GOOGLE_EMAIL: 'owner@example.com', EMAIL_ENABLED: 'true', ...overrides })
const codes = result => result.issues.map(issue => issue.code)

test('missing configuration lists every required field and live mode fails', () => {
  const result = checkConfiguration({}, { requireLive: true })
  assert.equal(result.ok, false); assert.equal(result.liveReady, false); assert.equal(result.mode, 'setup')
  for (const code of ['ORIGIN_MISSING', 'GOOGLE_CLIENT_ID_MISSING', 'GOOGLE_CLIENT_SECRET_MISSING', 'ENCRYPTION_KEY_MISSING', 'ADMIN_IDENTITY_MISSING', 'EMAIL_DISABLED', 'LIVE_MODE_REQUIRED']) assert.ok(codes(result).includes(code), code)
  assert.ok(checkConfiguration({}).ok, 'setup can remain a valid preparation environment')
})

test('complete synthetic configuration is only locally ready, never certified connected', () => {
  const result = checkConfiguration(complete(), { requireLive: true })
  assert.equal(result.ok, true); assert.equal(result.liveReady, true)
  const report = formatReport(result, { requireLive: true })
  assert.match(report, /siguen sin comprobar/); assert.match(report, /no contacta Google/)
  assert.match(report, /zona horaria remota/)
})

test('malformed origins and noncanonical or incorrectly sized keys fail without throwing', () => {
  for (const origin of ['not a URL', 'ftp://barber.example', 'https://barber.example/path', 'https://user:secret@barber.example', 'https://barber.example?token=x', 'https://barber.example#hash']) {
    const result = checkConfiguration(complete({ APP_ORIGIN: origin }), { requireLive: true })
    assert.equal(result.ok, false); assert.ok(codes(result).includes('INVALID_ORIGIN'))
  }
  for (const key of ['invalid-secret', randomBytes(31).toString('base64'), randomBytes(33).toString('base64'), `${randomBytes(32).toString('base64')}!!`]) {
    const result = checkConfiguration(complete({ TOKEN_ENCRYPTION_KEY: key }), { requireLive: true })
    assert.equal(result.liveReady, false); assert.ok(codes(result).includes('INVALID_ENCRYPTION_KEY'))
  }
})

test('callback must match scheme, host, port and exact path with no query or credentials', () => {
  for (const callback of ['https://different.example/api/auth/google/callback', 'http://barber.example/api/auth/google/callback', 'https://barber.example:9443/api/auth/google/callback', 'https://barber.example/api/auth/google/callback/', 'https://barber.example/api/auth/google/callback?token=x', 'https://user:secret@barber.example/api/auth/google/callback', 'not-a-callback']) {
    const result = checkConfiguration(complete({ GOOGLE_REDIRECT_URI: callback }), { requireLive: true })
    assert.equal(result.liveReady, false); assert.ok(codes(result).some(code => ['CALLBACK_MISMATCH', 'INVALID_CALLBACK'].includes(code)))
  }
  const derived = checkConfiguration(complete({ GOOGLE_REDIRECT_URI: '' }), { requireLive: true })
  assert.equal(derived.liveReady, true); assert.ok(codes(derived).includes('CALLBACK_DERIVED'))
})

test('demo never passes live certification and local bindings are checked', () => {
  const local = complete({ APP_MODE: 'demo', APP_ORIGIN: 'http://localhost:8443', GOOGLE_REDIRECT_URI: 'http://localhost:8443/api/auth/google/callback' })
  const result = checkConfiguration(local, { requireLive: true })
  assert.equal(result.mode, 'demo'); assert.equal(result.liveReady, false); assert.ok(codes(result).includes('DEMO_NOT_GOOGLE')); assert.ok(codes(result).includes('LIVE_MODE_REQUIRED'))
  assert.equal(checkConfiguration({ ...local, HOST: '0.0.0.0' }).ok, false)
  assert.equal(checkConfiguration({ ...local, API_HOST: '0.0.0.0' }).ok, false)
})

test('flags, allowlist, public HTTPS and numeric settings are validated', () => {
  const cases = [
    [{ APP_MODE: 'anything' }, 'INVALID_MODE'], [{ EMAIL_ENABLED: 'TRUE' }, 'INVALID_EMAIL_FLAG'],
    [{ ADMIN_GOOGLE_EMAIL: 'not-an-email' }, 'INVALID_ADMIN_EMAIL'], [{ ADMIN_GOOGLE_SUB: ' ' , ADMIN_GOOGLE_EMAIL: '' }, 'ADMIN_IDENTITY_MISSING'],
    [{ APP_ORIGIN: 'http://barber.example', GOOGLE_REDIRECT_URI: 'http://barber.example/api/auth/google/callback' }, 'PUBLIC_HTTPS_REQUIRED'],
    [{ PORT: 'NaN' }, 'INVALID_PORT'], [{ API_PORT: '70000' }, 'INVALID_PORT'], [{ GOOGLE_POLL_INTERVAL_MS: 'Infinity' }, 'INVALID_POLL_INTERVAL'],
  ]
  for (const [overrides, code] of cases) { const result = checkConfiguration(complete(overrides), { requireLive: true }); assert.equal(result.ok, false); assert.ok(codes(result).includes(code), code) }
  assert.equal(checkConfiguration(complete({ APP_MODE: 'setup' }), { requireLive: true }).liveReady, false)
  const sub = checkConfiguration(complete({ ADMIN_GOOGLE_EMAIL: '', ADMIN_GOOGLE_SUB: 'owner-sub' }), { requireLive: true })
  assert.equal(sub.liveReady, true)
})

test('reports and CLI never print configuration values even when those values are invalid', () => {
  const secrets = ['PRIVATE-CREDENTIAL-SENTINEL', 'secret-in-url-SENTINEL', 'private-owner-SENTINEL@example.com']
  const env = complete({ GOOGLE_CLIENT_ID: secrets[0], GOOGLE_CLIENT_SECRET: secrets[0], TOKEN_ENCRYPTION_KEY: secrets[0], ADMIN_GOOGLE_EMAIL: secrets[2], APP_ORIGIN: `https://owner:${secrets[1]}@barber.example`, GOOGLE_REDIRECT_URI: `https://barber.example/api/auth/google/callback?secret=${secrets[0]}` })
  let output = ''
  assert.equal(runPreflight({ argv: ['--live'], env, write: value => { output += value } }), 1)
  for (const value of secrets) assert.ok(!output.includes(value))
  assert.ok(!JSON.stringify(checkConfiguration(env)).includes(secrets[0]))
  output = ''; assert.equal(runPreflight({ argv: ['--unknown-secret-sentinel'], env, write: value => { output += value } }), 2)
  assert.ok(!output.includes('unknown-secret-sentinel'))
})

test('offline diagnosis does not create a database or mutate supplied environment', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'barber-preflight-test-'))
  t.after(() => { if (path.dirname(directory) === os.tmpdir()) rmSync(directory, { recursive: true, force: true }) })
  const env = complete({ DATA_DIR: path.join(directory, 'unused-data') }), original = JSON.stringify(env)
  const result = checkConfiguration(Object.freeze(env), { requireLive: true, cwd: directory })
  assert.equal(result.liveReady, true); assert.equal(JSON.stringify(env), original); assert.deepEqual(readdirSync(directory), [])
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('External requests forbidden in preflight') }
  try { assert.equal(runPreflight({ argv: ['--live'], env, cwd: directory, write: () => {} }), 0) }
  finally { globalThis.fetch = originalFetch }
})

test('CLI loads only a synthetic .env and existing environment values keep precedence', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'barber-preflight-cli-test-'))
  t.after(() => { if (path.dirname(directory) === os.tmpdir()) rmSync(directory, { recursive: true, force: true }) })
  const values = complete({ GOOGLE_CLIENT_SECRET: 'CLI-SECRET-NEVER-PRINT', DATA_DIR: './must-not-be-created' })
  writeFileSync(path.join(directory, '.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'))
  const safeEnvironment = {}
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) safeEnvironment[key] = process.env[key]
  const filename = fileURLToPath(new URL('../preflight.mjs', import.meta.url))
  const ready = spawnSync(process.execPath, [filename, '--live'], { cwd: directory, env: safeEnvironment, encoding: 'utf8' })
  assert.equal(ready.status, 0, ready.stderr)
  assert.ok(!ready.stdout.includes(values.GOOGLE_CLIENT_SECRET)); assert.match(ready.stdout, /siguen sin comprobar/)
  const disabled = spawnSync(process.execPath, [filename, '--live'], { cwd: directory, env: { ...safeEnvironment, EMAIL_ENABLED: 'false' }, encoding: 'utf8' })
  assert.equal(disabled.status, 1); assert.match(disabled.stdout, /EMAIL_ENABLED=true/)
  assert.deepEqual(readdirSync(directory), ['.env'])
})
