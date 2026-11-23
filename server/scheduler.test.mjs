import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createScheduler } from './scheduler.mjs'
import { createApplication } from './http.mjs'
import { loadConfig } from './config.mjs'
import { runScheduled } from '../scripts/run-scheduled.mjs'

const secret = 'a'.repeat(64)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

async function fixture(t, env = {}) {
  const parent = fs.realpathSync(os.tmpdir())
  const directory = fs.mkdtempSync(path.join(parent, 'elmorenaje-scheduler-'))
  const config = loadConfig({ APP_MODE: 'setup', APP_ORIGIN: 'http://localhost:8443', DATA_DIR: directory, CRON_SECRET: secret, ...env })
  const app = createApplication(config)
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}`
  t.after(async () => {
    await app.close()
    const target = fs.realpathSync(directory)
    assert.equal(path.dirname(target), parent)
    assert.ok(path.basename(target).startsWith('elmorenaje-scheduler-'))
    fs.rmSync(target, { recursive: true, force: true })
  })
  return { app, base }
}

test('overlapping scheduled cycles share one sync and run due jobs after sync', async () => {
  const gate = deferred(), entered = deferred(), calls = []
  const scheduler = createScheduler({ async syncCalendars() { calls.push('sync'); entered.resolve(); await gate.promise }, async runJobs() { calls.push('jobs') } }, { pollInterval: 60000 })
  const first = scheduler.runCycle(), second = scheduler.runCycle()
  assert.equal(first, second)
  await entered.promise
  assert.deepEqual(calls, ['sync'])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['sync', 'jobs'])
  await scheduler.runCycle()
  assert.deepEqual(calls, ['sync', 'jobs', 'sync', 'jobs'])
})

test('a failed sync releases the cycle for retry without processing jobs first', async () => {
  let fail = true, jobs = 0
  const scheduler = createScheduler({ async syncCalendars() { if (fail) throw new Error('synthetic sync error') }, async runJobs() { jobs++ } }, { pollInterval: 60000 })
  await assert.rejects(scheduler.runCycle())
  assert.equal(jobs, 0)
  fail = false
  await scheduler.runCycle()
  assert.equal(jobs, 1)
})

test('cron route requires its own bearer secret and rejects query keys and cross-site calls', async t => {
  const { app, base } = await fixture(t)
  let cycles = 0
  app.service.syncCalendars = async () => { cycles++ }
  app.service.runJobs = async () => {}
  for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
    assert.equal((await fetch(base + '/api/internal/jobs', { method: 'POST', headers })).status, 401)
  }
  assert.equal((await fetch(base + '/api/internal/jobs?key=' + secret, { method: 'POST' })).status, 401)
  assert.equal((await fetch(base + '/api/internal/jobs', { headers: { Authorization: `Bearer ${secret}` } })).status, 404)
  assert.equal((await fetch(base + '/api/internal/jobs', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, Origin: 'https://evil.invalid' } })).status, 403)
  assert.equal(cycles, 0)
  await runScheduled({ APP_ORIGIN: base, CRON_SECRET: secret })
  assert.equal(cycles, 1)
})

test('missing or invalid cron configuration disables only the trigger', async t => {
  for (const configured of ['', 'short', 'z'.repeat(64)]) {
    const { base } = await fixture(t, { CRON_SECRET: configured })
    assert.equal((await fetch(base + '/api/health')).status, 200)
    const response = await fetch(base + '/api/internal/jobs', { method: 'POST' })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'CRON_NOT_CONFIGURED')
  }
})

test('cron requests and startup workers join the same in-flight cycle', { timeout: 15000 }, async t => {
  const { app, base } = await fixture(t)
  const gate = deferred(), entered = deferred(), bothRequests = deferred()
  let syncs = 0, jobs = 0, requests = 0
  app.service.syncCalendars = async () => { syncs++; entered.resolve(); await gate.promise }
  app.service.runJobs = async () => { jobs++ }
  app.server.on('request', req => { if (req.url === '/api/internal/jobs' && ++requests === 2) bothRequests.resolve() })
  app.startWorkers()
  await entered.promise
  const options = { method: 'POST', headers: { Authorization: `Bearer ${secret}` } }
  const first = fetch(base + '/api/internal/jobs', options), second = fetch(base + '/api/internal/jobs', options)
  try {
    await bothRequests.promise
    assert.equal(syncs, 1)
    assert.equal(jobs, 0)
  } finally { gate.resolve() }
  for (const response of await Promise.all([first, second])) assert.deepEqual(await response.json(), { ok: true })
  assert.equal(syncs, 1)
  assert.equal(jobs, 1)
})

test('cron client validates configuration before transmitting a secret', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; throw new Error('must not reach network') }
  for (const APP_ORIGIN of [undefined, 'not-a-url', 'http://public.invalid', 'https://user:pass@public.invalid', 'https://public.invalid/path', 'https://public.invalid?key=value', 'https://public.invalid#hash']) await assert.rejects(runScheduled({ APP_ORIGIN, CRON_SECRET: secret }, fetchImpl))
  await assert.rejects(runScheduled({ APP_ORIGIN: 'https://public.invalid', CRON_SECRET: 'private-invalid-secret' }, fetchImpl))
  assert.equal(calls, 0)
})

test('cron client keeps the secret in the header and disallows redirects', async () => {
  await runScheduled({ APP_ORIGIN: 'https://barber.example', CRON_SECRET: secret }, async (url, options) => {
    assert.equal(String(url), 'https://barber.example/api/internal/jobs')
    assert.equal(url.search, '')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, `Bearer ${secret}`)
    return Response.json({ ok: true })
  })
})

test('cron client failures do not expose network errors or response content', async () => {
  const env = { APP_ORIGIN: 'https://barber.example', CRON_SECRET: secret }
  const privateValue = 'private-response-sentinel'
  const failures = [async () => { throw new Error(privateValue) }, async () => new Response(privateValue, { status: 500 }), async () => new Response(privateValue), async () => Response.json({ privateValue })]
  for (const fetchImpl of failures) await assert.rejects(runScheduled(env, fetchImpl), error => !error.message.includes(privateValue) && !error.message.includes(secret))
})
