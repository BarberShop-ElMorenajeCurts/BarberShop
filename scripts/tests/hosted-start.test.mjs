import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const project = fileURLToPath(new URL('../../', import.meta.url))

async function fixture() {
  const parent = await fs.realpath(os.tmpdir())
  const root = await fs.mkdtemp(path.join(parent, 'elmorenaje-hosted-start-'))
  await fs.copyFile(path.join(project, 'app.cjs'), path.join(root, 'app.cjs'))
  await fs.mkdir(path.join(root, 'server'))
  for (const file of await fs.readdir(path.join(project, 'server'))) {
    if (file.endsWith('.mjs') && !file.endsWith('.test.mjs')) await fs.copyFile(path.join(project, 'server', file), path.join(root, 'server', file))
  }
  await fs.mkdir(path.join(root, 'config'))
  for (const file of ['business.public.json', 'photography.public.json']) await fs.copyFile(path.join(project, 'config', file), path.join(root, 'config', file))
  await fs.mkdir(path.join(root, 'dist'))
  await fs.writeFile(path.join(root, 'dist', 'index.html'), '<html><div id="root">hosted-start-check</div></html>')
  await fs.writeFile(path.join(root, '.env'), 'APP_MODE=demo\nAPP_ORIGIN=http://wrong-origin.invalid\n')
  return { root, parent, async clean() {
    const target = await fs.realpath(root)
    assert.equal(path.dirname(target), parent)
    assert.ok(path.basename(target).startsWith('elmorenaje-hosted-start-'))
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } }
}

function launch(f, args, overrides = {}) {
  const child = spawn(process.execPath, args, {
    cwd: f.parent,
    env: { ...process.env, APP_MODE: 'setup', HOST: '127.0.0.1', PORT: '0', APP_ORIGIN: 'http://localhost:8443', DATA_DIR: '.data', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', ADMIN_GOOGLE_EMAIL: '', ADMIN_GOOGLE_SUB: '', TOKEN_ENCRYPTION_KEY: '', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = '', errors = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { errors += chunk })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El servidor no anunció su puerto.')), 15000)
    child.stdout.on('data', () => {
      const port = /API iniciada en 127\.0\.0\.1:(\d+)/.exec(output)?.[1]
      if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`) }
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`El servidor terminó (${code}): ${errors}`)) })
  })
  return { child, ready, errors: () => errors, async stop() {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  } }
}

for (const loader of ['direct', 'require']) test(`hosted entry starts through ${loader} outside the project directory`, { timeout: 25000 }, async () => {
  const f = await fixture()
  const entry = path.join(f.root, 'app.cjs')
  const runner = launch(f, loader === 'direct' ? [entry] : ['-e', 'require(process.argv[1])', entry])
  try {
    const origin = await runner.ready
    for (const route of ['/', '/admin']) {
      const response = await fetch(origin + route)
      assert.equal(response.status, 200)
      assert.match(await response.text(), /hosted-start-check/)
    }
    const health = await fetch(origin + '/api/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { ok: true, mode: 'setup' })
    const session = await (await fetch(origin + '/api/session')).json()
    assert.equal(session.authenticated, false)
    assert.equal(session.mode, 'setup', 'the .env file must not override hosting variables')
    assert.ok((await fs.stat(path.join(f.root, '.data', 'live', 'appointments.sqlite'))).isFile())
  } finally { await runner.stop(); await f.clean() }
})

test('hosted entry reports startup failure without exposing invalid configuration input', { timeout: 25000 }, async () => {
  const f = await fixture()
  const runner = launch(f, [path.join(f.root, 'app.cjs')], { APP_ORIGIN: 'private-invalid-origin-sentinel' })
  try {
    await assert.rejects(runner.ready)
    assert.notEqual(runner.child.exitCode, 0)
    assert.match(runner.errors(), /ERR_INVALID_URL/)
    assert.doesNotMatch(runner.errors(), /private-invalid-origin-sentinel/)
  } finally { await runner.stop(); await f.clean() }
})
