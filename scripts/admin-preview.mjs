// Isolated, loopback-only rehearsal. Never loads .env or Google credentials.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../server/config.mjs'
import { createApplication } from '../server/http.mjs'
import { Store } from '../server/store.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.ADMIN_PREVIEW_PORT || 8444)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ADMIN_PREVIEW_PORT debe estar entre 1024 y 65535.')
if (!existsSync(path.join(project, 'dist', 'index.html'))) throw new Error('Compila primero con npm run build.')
const config = loadConfig({ APP_MODE: 'demo', APP_ORIGIN: `http://localhost:${port}`, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: path.join(project, '.data', 'admin-preview') }, project)
const databaseExists = existsSync(path.join(config.dataDir, 'appointments.sqlite'))
const store = new Store(config.dataDir)
try {
  if (databaseExists && store.get('admin.preview') !== true) throw new Error('La base de demostración no tiene la marca prevista; no se modificará.')
  if (!databaseExists) {
    const catalog = store.get('catalog')
    catalog.settings.businessDataConfirmed = true
    catalog.barbers.forEach((barber, index) => { barber.calendarId = `demo-barber-${index + 1}` })
    store.transaction(() => { store.set('catalog', catalog); store.set('admin.preview', true) })
  }
  const app = createApplication(config, { store })
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, config.host, resolve) })
  app.startWorkers()
  console.log(`Portal de demostración: http://localhost:${port}/admin`)
  console.log('Catálogo inicial del negocio, con cambios de prueba persistentes y separados de los datos reales.')
  console.log('No utiliza Google ni envía correos. Ctrl+C para detener.')
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0) })
} catch (error) { store.close(); throw error }
