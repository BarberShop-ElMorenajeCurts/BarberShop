import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../../', import.meta.url))
const secret = 'b'.repeat(64)

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir())
  const root = await fs.mkdtemp(path.join(parent, 'elmorenaje-cron-cli-'))
  const version = path.join(root, 'versions', 'v1')
  await fs.mkdir(path.join(version, 'nodejs', 'scripts'), { recursive: true })
  await fs.mkdir(path.join(version, 'nodejs', 'server'))
  await fs.mkdir(path.join(version, 'nodejs', 'config'))
  for (const file of ['scripts/run-scheduled.mjs', 'server/config.mjs', 'config/business.public.json']) await fs.copyFile(path.join(project, file), path.join(version, 'nodejs', file))
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const envFile = path.join(root, 'cron.env')
  await fs.writeFile(envFile, `APP_ORIGIN=http://127.0.0.1:${server.address().port}\nCRON_SECRET=${secret}\n`)
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    const target = await fs.realpath(root)
    assert.equal(path.dirname(target), parent)
    assert.ok(path.basename(target).startsWith('elmorenaje-cron-cli-'))
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { root, version, envFile, requests }
}

async function execute(entry, envFile, env = {}) {
  // Do not reuse the parent shell's scheduler secret or origin in these tests.
  const childEnv = { ...process.env, ...env }
  delete childEnv.CRON_SECRET
  if (!Object.hasOwn(env, 'APP_ORIGIN')) delete childEnv.APP_ORIGIN
  const child = spawn(process.execPath, [`--env-file=${envFile}`, entry], { env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('El cliente cron no terminó.')) }, 10000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

function expectSuccess(result, f) {
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Iniciando ciclo de tareas/)
  assert.match(result.stdout, /Ciclo de tareas completado/)
  assert.deepEqual(f.requests, [{ path: '/api/internal/jobs', method: 'POST', authorization: `Bearer ${secret}` }])
  assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret))
}

test('scheduled CLI loads its private environment and visibly runs a protected cycle', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  expectSuccess(await execute(path.join(f.version, 'nodejs', 'scripts', 'run-scheduled.mjs'), f.envFile), f)
})

test('scheduled CLI still runs through a current link to a deployment version', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const current = path.join(f.root, 'current')
  try { await fs.symlink(f.version, current, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('El entorno no permite crear enlaces para esta prueba.'); return }
    throw error
  }
  expectSuccess(await execute(path.join(current, 'nodejs', 'scripts', 'run-scheduled.mjs'), f.envFile), f)
})

test('scheduled CLI reports safe configuration failures to stdout with a failed exit code', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const privateInput = 'private-invalid-origin-sentinel'
  const result = await execute(path.join(f.version, 'nodejs', 'scripts', 'run-scheduled.mjs'), f.envFile, { APP_ORIGIN: privateInput })
  assert.equal(result.code, 1)
  assert.match(result.stdout, /Iniciando ciclo de tareas/)
  assert.match(result.stdout, /ERROR: APP_ORIGIN no es válida/)
  assert.ok(!result.stdout.includes(privateInput) && !result.stdout.includes(secret))
  assert.deepEqual(f.requests, [])
})
