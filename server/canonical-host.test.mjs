import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { Store } from './store.mjs'
import { createApplication } from './http.mjs'

async function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir())
  const directory = fs.mkdtempSync(path.join(parent, 'elmorenaje-canonical-'))
  const config = loadConfig({ APP_MODE: 'setup', APP_ORIGIN: 'https://barber.example', DATA_DIR: directory, CRON_SECRET: 'c'.repeat(64) })
  const initial = new Store(config.dataDir)
  initial.job('mail-in-flight', 'email', null, Date.now(), {})
  initial.job('hold-in-flight', 'hold', null, Date.now(), {})
  initial.db.prepare("UPDATE jobs SET state='running'").run()
  initial.close()
  const app = createApplication(config)
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await app.close()
    const target = fs.realpathSync(directory)
    assert.equal(path.dirname(target), parent)
    assert.ok(path.basename(target).startsWith('elmorenaje-canonical-'))
    fs.rmSync(target, { recursive: true, force: true })
  })
  return { app, config, base: `http://127.0.0.1:${app.server.address().port}` }
}

const state = (app, id) => app.store.db.prepare('SELECT state FROM jobs WHERE id=?').get(id).state
// Native http preserves explicit Host headers; fetch may replace them.
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET', headers: options.headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

test('www redirects pages and API requests to the configured origin before recovering or running jobs', async t => {
  const { app, base } = await fixture(t)
  let syncs = 0, runs = 0
  app.service.syncCalendars = async () => { syncs++ }
  app.service.runJobs = async () => { runs++ }
  app.startWorkers()
  for (const [route, method] of [['/admin?next=calendar', 'GET'], ['/api/auth/google', 'GET'], ['/api/bookings?source=www', 'POST']]) {
    const response = await request(base + route, { method, headers: { Host: 'www.barber.example' } })
    assert.equal(response.status, 308)
    assert.equal(response.headers.get('location'), 'https://barber.example' + route)
    assert.equal(response.headers.get('set-cookie'), null)
  }
  assert.equal(syncs, 0)
  assert.equal(runs, 0)
  assert.equal(state(app, 'mail-in-flight'), 'running')
  assert.equal(state(app, 'hold-in-flight'), 'running')
  const health = await request(base + '/api/health', { headers: { Host: 'barber.example' } })
  assert.equal(health.status, 200)
  assert.equal(state(app, 'mail-in-flight'), 'uncertain')
  assert.equal(state(app, 'hold-in-flight'), 'pending')
  assert.equal(syncs, 1)
  assert.equal(runs, 1)
  app.store.db.prepare("UPDATE jobs SET state='running' WHERE id='hold-in-flight'").run()
  await request(base + '/api/health', { headers: { Host: 'barber.example' } })
  assert.equal(state(app, 'hold-in-flight'), 'running', 'canonical requests recover only once per process')
})

test('proxy host fallback only recognizes configured domains and cannot choose a redirect destination', async t => {
  const { app, base } = await fixture(t)
  app.startWorkers()
  const alias = await request(base + '/admin?section=barbers', { headers: { 'X-Forwarded-Host': 'www.barber.example' } })
  assert.equal(alias.status, 308)
  assert.equal(alias.headers.get('location'), 'https://barber.example/admin?section=barbers')
  assert.equal(state(app, 'mail-in-flight'), 'running')
  const unrelated = await request(base + '/api/health', { headers: { 'X-Forwarded-Host': 'evil.invalid' } })
  assert.equal(unrelated.status, 200)
  assert.equal(unrelated.headers.get('location'), null)
  assert.equal(state(app, 'mail-in-flight'), 'running')
  const canonical = await request(base + '/api/health', { headers: { Host: 'barber.example', 'X-Forwarded-Host': 'www.barber.example' } })
  assert.equal(canonical.status, 200, 'a recognized direct host takes precedence')
  assert.equal(state(app, 'mail-in-flight'), 'uncertain')
})

test('an authenticated cron can activate the primary process when the proxy hides Host', async t => {
  const { app, base, config } = await fixture(t)
  let syncs = 0
  app.service.syncCalendars = async () => { syncs++ }
  app.service.runJobs = async () => {}
  app.startWorkers()
  assert.equal((await fetch(base + '/api/internal/jobs', { method: 'POST' })).status, 401)
  assert.equal(state(app, 'mail-in-flight'), 'running')
  const response = await fetch(base + '/api/internal/jobs', { method: 'POST', headers: { Authorization: `Bearer ${config.cronSecret}` } })
  assert.equal(response.status, 200)
  assert.equal(state(app, 'mail-in-flight'), 'uncertain')
  assert.equal(syncs, 1)
})
