// Boots only an explicit local release in setup mode with disposable storage.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--directory' || !args[1]) {
  console.error('Uso: node scripts/smoke-release.mjs --directory DIRECTORIO_DEL_PAQUETE')
  process.exitCode = 2
} else {
  await check(path.resolve(args[1])).catch(error => {
    console.error(`La prueba local del paquete no pasó: ${error.message}`)
    process.exitCode = 1
  })
}

async function check(directory) {
  const rootStat = await fs.lstat(directory)
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'El paquete debe ser un directorio regular.')
  const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
  const start = /^node ([A-Za-z0-9_./-]+\.mjs)$/.exec(pkg.scripts?.start || '')
  assert.ok(start && !start[1].split('/').includes('..'), 'Se requiere un arranque explícito con node y una ruta .mjs dentro del paquete.')
  const entry = path.resolve(directory, start[1])
  assert.ok(entry.startsWith(directory + path.sep), 'El arranque está fuera del paquete.')
  const entryStat = await fs.lstat(entry)
  assert.ok(entryStat.isFile() && !entryStat.isSymbolicLink(), 'El arranque debe ser un archivo regular.')

  const tempParent = path.resolve(os.tmpdir())
  const temporary = await fs.mkdtemp(path.join(tempParent, 'elmorenaje-release-http-'))
  let child
  try {
    child = spawn(process.execPath, [start[1]], {
      cwd: directory,
      env: {
        ...process.env, APP_MODE: 'setup', HOST: '127.0.0.1', PORT: '0',
        APP_ORIGIN: 'http://127.0.0.1', DATA_DIR: temporary,
        GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '',
        ADMIN_GOOGLE_EMAIL: '', ADMIN_GOOGLE_SUB: '', TOKEN_ENCRYPTION_KEY: '', EMAIL_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
    const port = await new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('La API del paquete no inició en 15 segundos.')), 15000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('El proceso terminó antes de iniciar la API.')) })
      child.stdout.on('data', data => {
        output = (output + data.toString()).slice(-4096)
        const match = /API iniciada en 127\.0\.0\.1:(\d+) · modo setup\./.exec(output)
        if (match) { clearTimeout(timer); resolve(Number(match[1])) }
      })
      // Drain without echoing runtime output or environment details.
      child.stderr.resume()
    })
    const base = `http://127.0.0.1:${port}`
    const get = async (route, status = 200) => {
      const response = await fetch(base + route, { signal: AbortSignal.timeout(5000) })
      assert.equal(response.status, status, `Respuesta inesperada en ${route}`)
      return response
    }
    const home = await get('/')
    assert.ok(home.headers.get('content-type')?.includes('text/html'))
    const html = await home.text()
    assert.match(html, /ElMorenaje/i)
    const script = /<script[^>]+src="([^"]+)"/.exec(html)
    assert.ok(script?.[1].startsWith('/assets/'), 'Los recursos compilados deben servirse desde el dominio del paquete.')
    const resource = await get(script[1])
    assert.ok(resource.headers.get('content-type')?.includes('javascript'))
    const admin = await get('/admin')
    assert.ok(admin.headers.get('content-type')?.includes('text/html'))
    const health = await (await get('/api/health')).json()
    assert.equal(health.mode, 'setup')
    const catalog = await (await get('/api/catalog')).json()
    assert.equal(catalog.mode, 'setup')
    assert.equal(catalog.bookingEnabled, false)
    assert.deepEqual(catalog.services.map(service => service.price).sort((a, b) => a - b), [5, 10, 30, 35, 40])
    assert.ok(catalog.services.every(service => service.currency === 'ANG' && service.durationMinutes === 30))
    assert.deepEqual(catalog.barbers.map(barber => barber.name), ['Moreno', 'Nestor', 'Reimon', 'Noel'])
    assert.equal(catalog.settings.whatsapp, '+59996768925')
    assert.equal(catalog.settings.facebook, 'https://www.facebook.com/el_morenajecuts')
    const photography = JSON.parse(await fs.readFile(path.join(directory, 'config', 'photography.public.json'), 'utf8'))
    assert.equal(photography.length, 31)
    assert.deepEqual([...catalog.photos].sort((a, b) => a.id.localeCompare(b.id)), [...photography].sort((a, b) => a.id.localeCompare(b.id)))
    for (const photo of catalog.photos) {
      assert.match(photo.url, /^\/assets\/photos\/img-\d{4}\.jpg$/)
      const picture = await get(photo.url)
      assert.ok(picture.headers.get('content-type')?.includes('image/jpeg'))
      const bytes = Buffer.from(await picture.arrayBuffer())
      assert.ok(bytes.length > 12 && bytes.length < 5 * 1024 * 1024)
      assert.equal(bytes.readUInt16BE(0), 0xffd8)
    }
    for (const barber of catalog.barbers) {
      assert.equal('calendarId' in barber, false)
      assert.equal(barber.serviceIds.length, 5)
      assert.deepEqual(barber.weeklyHours, [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '21:00' })))
    }
    const session = await (await get('/api/session')).json()
    assert.equal(session.authenticated, false)
    await get('/api/admin/overview', 401)
    await stop(child)
    console.log('Paquete verificado por HTTP: web, portal, catálogo, 31 fotografías propias, horarios y acceso administrativo protegido en setup. Sin Google ni correos reales.')
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      await stop(child)
    }
    const relative = path.relative(tempParent, temporary)
    const stat = await fs.lstat(temporary)
    assert.ok(relative.startsWith('elmorenaje-release-http-') && !relative.includes(path.sep) && path.dirname(temporary) === tempParent && stat.isDirectory() && !stat.isSymbolicLink(), 'La limpieza no está dentro del temporal propio.')
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve, reject) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 3000)
    const deadline = setTimeout(() => reject(new Error('No se pudo cerrar el proceso de prueba del paquete.')), 10000)
    child.once('exit', () => { clearTimeout(force); clearTimeout(deadline); resolve() })
    child.kill('SIGTERM')
  })
}
