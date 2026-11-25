import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { createApplication } from './http.mjs'

test('public directory documents work without authentication while SPA and protected API routes keep their behavior', async t => {
  const parent = fs.realpathSync(os.tmpdir())
  const directory = fs.mkdtempSync(path.join(parent, 'elmorenaje-static-'))
  const config = loadConfig({ APP_MODE: 'setup', APP_ORIGIN: 'http://localhost', DATA_DIR: path.join(directory, 'data') })
  config.distDir = path.join(directory, 'dist')
  fs.mkdirSync(path.join(config.distDir, 'privacidad'), { recursive: true })
  const document = '<!doctype html><html lang="es"><title>Privacy document</title><body>Public policy</body></html>'
  const spa = '<!doctype html><html><body><div id="root"></div></body></html>'
  fs.writeFileSync(path.join(config.distDir, 'privacidad', 'index.html'), document)
  fs.writeFileSync(path.join(config.distDir, 'index.html'), spa)
  const app = createApplication(config)
  t.after(async () => {
    await app.close()
    const target = fs.realpathSync(directory)
    assert.equal(path.dirname(target), parent)
    assert.ok(path.basename(target).startsWith('elmorenaje-static-'))
    fs.rmSync(target, { recursive: true, force: true })
  })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}`
  for (const route of ['/privacidad', '/privacidad/']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(await response.text(), document)
    const head = await fetch(base + route, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(document))
    assert.equal(await head.text(), '')
  }
  for (const route of ['/', '/admin', '/unknown-spa-route']) {
    assert.equal(await (await fetch(base + route)).text(), spa)
  }
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401)
  assert.equal((await fetch(base + '/missing.css')).status, 404)
  assert.equal((await fetch(base + '/privacidad', { method: 'POST' })).status, 405)
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true, mode: 'setup' })
})
