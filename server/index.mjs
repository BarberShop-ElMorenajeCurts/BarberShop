import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'
import { createApplication } from './http.mjs'

export { createApplication, loadConfig }

export async function startServer(env = process.env) {
  const config = loadConfig(env)
  const app = createApplication(config)
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(config.port, config.host, resolve) })
  app.startWorkers()
  console.log(`API iniciada en ${config.host}:${app.server.address().port} · modo ${config.mode}.`)
  return app
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Node's env-file loader does not override variables already provided by the host.
  try { process.loadEnvFile(path.resolve('.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const app = await startServer()
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0) })
}
