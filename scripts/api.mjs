// Keep the API port independent from the existing Figma/Vite PORT.
process.env.PORT = process.env.API_PORT || '3001'
process.env.HOST = process.env.API_HOST || '127.0.0.1'
if (process.argv.includes('--demo')) {
  process.env.APP_MODE = 'demo'
  process.env.APP_ORIGIN ||= 'http://localhost:8443'
}
const { startServer } = await import('../server/index.mjs')
const app = await startServer()
let closing = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) return
    closing = true
    await app.close()
    process.exit(0)
  })
}
