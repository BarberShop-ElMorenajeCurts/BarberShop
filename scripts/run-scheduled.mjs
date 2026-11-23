import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLocalHost } from '../server/config.mjs'

// This client never opens SQLite or receives customer data. Jobs run in the web process.
export async function runScheduled(env = process.env, fetchImpl = fetch) {
  let origin
  try { origin = new URL(env.APP_ORIGIN) } catch { throw new Error('APP_ORIGIN no es válida.') }
  if (!['https:', 'http:'].includes(origin.protocol) || (origin.protocol !== 'https:' && !isLocalHost(origin.hostname)) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_ORIGIN debe ser un origen HTTPS; HTTP solo se permite en localhost.')
  if (!/^[a-f0-9]{64}$/i.test(env.CRON_SECRET || '')) throw new Error('CRON_SECRET debe contener 64 caracteres hexadecimales.')
  let response
  try {
    response = await fetchImpl(new URL('/api/internal/jobs', origin), {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(90000),
    })
  } catch { throw new Error('No se pudo contactar con el disparador de tareas; revisa el servidor y la URL.') }
  if (!response.ok) throw new Error(`El servidor rechazó el ciclo de tareas (HTTP ${response.status}).`)
  let result
  try { result = await response.json() } catch { throw new Error('El servidor no devolvió JSON válido.') }
  if (result?.ok !== true) throw new Error('El servidor no confirmó el ciclo de tareas.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runScheduled(); console.log('Ciclo de tareas completado.') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
