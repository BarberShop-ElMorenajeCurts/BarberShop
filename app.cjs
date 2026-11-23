// Hosting loaders can require this file; the ESM server is loaded asynchronously.
const path = require('node:path')

async function boot() {
  // Resolve dist, config and relative DATA_DIR from the project, not the loader.
  process.chdir(__dirname)
  try { process.loadEnvFile(path.join(__dirname, '.env')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const { startServer } = await import('./server/index.mjs')
  const app = await startServer()
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return
    closing = true
    await app.close()
    process.exit(0)
  })
  return app
}

module.exports = boot()
module.exports.catch(error => {
  // Do not print environment values or an error's possibly sensitive input.
  console.error(`ElMorenaje: no se pudo iniciar el servidor (${error.code || 'STARTUP_ERROR'}).`)
  if (error.code === 'EACCES' || error.code === 'EPERM') console.error('Comprueba los permisos de DATA_DIR y de los archivos de la aplicación.')
  const frames = String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line))
  if (frames.length) console.error(frames.join('\n'))
  process.exitCode = 1
})
