import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Auth, sameSecret } from './auth.mjs'
import { BookingService } from './service.mjs'
import { GoogleAdapter, DemoAdapter } from './google.mjs'
import { Store } from './store.mjs'
import { assert, Problem } from './config.mjs'
import { createScheduler } from './scheduler.mjs'

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
export async function body(req) {
  assert((req.headers['content-type'] || '').split(';')[0] === 'application/json', 'UNSUPPORTED_MEDIA_TYPE', 'La solicitud debe usar JSON.', 415)
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) throw new Problem(413, 'PAYLOAD_TOO_LARGE', 'La solicitud supera el tamaño permitido.')
    chunks.push(chunk)
  }
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed)); return parsed }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'INVALID_JSON', 'El cuerpo JSON no es válido.') }
}
export function createApplication(config, { store: injectedStore, adapter: injectedAdapter, now = Date.now, fetchImpl = fetch } = {}) {
  const store = injectedStore || new Store(config.dataDir, { demo: config.mode === 'demo' })
  const adapter = injectedAdapter || (config.mode === 'demo' ? new DemoAdapter(store) : new GoogleAdapter(config, store, { now, fetchImpl }))
  const service = new BookingService(config, store, adapter, { now }), auth = new Auth(config, store, adapter, { now, fetchImpl })
  const scheduler = createScheduler(service, {
    pollInterval: config.pollInterval,
    onError: () => store.audit('worker.error', null, 'No se pudo ejecutar el ciclo de tareas.', now()),
  })
  const limits = new Map()
  const rateLimit = (req, bucket, max = 30) => {
    const key = `${bucket}:${req.socket.remoteAddress}`, current = limits.get(key)
    if (!current || current.until < now()) { limits.set(key, { count: 1, until: now() + 10 * 60000 }); return }
    assert(current.count++ < max, 'RATE_LIMITED', 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.', 429)
    if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now()) limits.delete(k)
  }
  function json(res, status, value) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(status === 204 ? '' : JSON.stringify(value)) }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    try {
      const url = new URL(req.url, config.origin), route = decodeURIComponent(url.pathname), method = req.method
      if (route.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store')
        if (!['GET', 'HEAD'].includes(method)) auth.origin(req)
        if (route === '/api/health' && method === 'GET') return json(res, 200, { ok: true, mode: config.mode })
        if (route === '/api/internal/jobs' && method === 'POST') {
          assert(/^[a-f0-9]{64}$/i.test(config.cronSecret), 'CRON_NOT_CONFIGURED', 'Las tareas programadas no están configuradas.', 503)
          assert(sameSecret(req.headers.authorization, `Bearer ${config.cronSecret}`), 'CRON_UNAUTHORIZED', 'Disparador de tareas no autorizado.', 401)
          await scheduler.runCycle()
          return json(res, 200, { ok: true })
        }
        if (route === '/api/catalog' && method === 'GET') return json(res, 200, service.catalog())
        if (route === '/api/session' && method === 'GET') return json(res, 200, auth.view(req))
        if (route === '/api/availability' && method === 'GET') { rateLimit(req, 'availability', 300); return json(res, 200, await service.available(url.searchParams.get('serviceId'), url.searchParams.get('barberId'), url.searchParams.get('date'))) }
        if (route === '/api/bookings' && method === 'POST') { rateLimit(req, 'booking'); return json(res, 201, await service.create(await body(req))) }
        if (route === '/api/auth/demo' && method === 'POST') { rateLimit(req, 'login', 20); return json(res, 200, auth.demo(req, res)) }
        if (route === '/api/auth/logout' && method === 'POST') { auth.logout(req, res); return json(res, 204) }
        if (route === '/api/auth/google' && method === 'GET') { rateLimit(req, 'login', 20); res.statusCode = 302; res.setHeader('Location', auth.start(req, res)); return res.end() }
        if (route === '/api/auth/google/callback' && method === 'GET') { await auth.callback(req, res, url); res.statusCode = 302; res.setHeader('Location', '/admin'); return res.end() }
        if (route.startsWith('/api/admin/')) {
          auth.require(req, !['GET', 'HEAD'].includes(method))
          if (route === '/api/admin/overview' && method === 'GET') return json(res, 200, service.overview())
          if (route === '/api/admin/catalog' && method === 'PUT') return json(res, 200, await service.updateCatalog(await body(req)))
          if (route === '/api/admin/bookings' && method === 'POST') return json(res, 201, await service.create(await body(req), true))
          let match = /^\/api\/admin\/bookings\/([^/]+)\/action$/.exec(route)
          if (match && method === 'POST') return json(res, 200, await service.action(match[1], await body(req)))
          if (route === '/api/admin/blocks' && method === 'POST') return json(res, 201, await service.createBlock(await body(req)))
          match = /^\/api\/admin\/blocks\/([^/]+)$/.exec(route)
          if (match && method === 'DELETE') { await service.deleteBlock(match[1]); return json(res, 204) }
          if (route === '/api/admin/photos' && method === 'POST') return json(res, 201, service.uploadPhoto(await body(req)))
          match = /^\/api\/admin\/photos\/([^/]+)$/.exec(route)
          if (match && method === 'PATCH') return json(res, 200, service.updatePhoto(match[1], await body(req)))
          if (match && method === 'DELETE') { service.deletePhoto(match[1]); return json(res, 204) }
        }
        throw new Problem(404, 'NOT_FOUND', 'Ruta no encontrada.')
      }
      assert(['GET', 'HEAD'].includes(method), 'METHOD_NOT_ALLOWED', 'Método no admitido.', 405)
      let filename
      if (route.startsWith('/media/')) {
        assert(/^\/media\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(route) && store.all('photos').some(photo => photo.url === route), 'NOT_FOUND', 'Imagen no encontrada.', 404)
        filename = path.join(config.mediaDir, path.basename(route))
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        const candidate = path.resolve(config.distDir, `.${route}`)
        assert(candidate === config.distDir || candidate.startsWith(`${config.distDir}${path.sep}`), 'NOT_FOUND', 'Ruta no encontrada.', 404)
        filename = existsSync(candidate) && statSync(candidate).isFile() ? candidate : path.extname(route) ? null : path.join(config.distDir, 'index.html')
        res.setHeader('Cache-Control', filename?.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600')
      }
      assert(filename && existsSync(filename) && statSync(filename).isFile(), 'NOT_FOUND', 'Compila la aplicación o usa el servidor Vite.', 404)
      res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream'); res.setHeader('Content-Length', statSync(filename).size)
      if (method === 'HEAD') return res.end()
      const stream = createReadStream(filename); stream.on('error', () => res.destroy()); stream.pipe(res)
    } catch (error) {
      if (res.headersSent) return res.destroy()
      const status = error instanceof Problem ? error.status : error instanceof URIError ? 400 : 500
      json(res, status, { error: { code: error instanceof Problem ? error.code : status === 400 ? 'INVALID_URL' : 'SERVER_ERROR', message: error instanceof Problem ? error.message : 'No se pudo completar la solicitud.' } })
      // Never print request bodies, OAuth responses, cookies, customer details or credentials.
      if (status === 500) store.audit('server.error', null, 'Error interno; revisar configuración y persistencia.', now())
    }
  })
  server.requestTimeout = 30000; server.headersTimeout = 15000
  function startWorkers() { scheduler.start() }
  async function close() { scheduler.stop(); await new Promise(resolve => server.close(resolve)); await scheduler.drain(); await service.tail; if (!injectedStore) store.close() }
  return { server, store, service, auth, adapter, startWorkers, close }
}
