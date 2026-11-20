import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArguments, restoreVerifiedBackup } from './backup.mjs'

export { restoreVerifiedBackup as restoreBackup } from './backup.mjs'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) console.log('Uso: node scripts/restore.mjs --source "RESPALDO_VERIFICADO" --destination "DATA_DIR_NUEVO/live" --offline\nLa API debe estar detenida. El padre del destino debe existir; el destino no puede existir. Nunca se sustituye la base actual.')
    else {
      const { destination, manifest } = await restoreVerifiedBackup(options)
      console.log(`Restauración verificada: ${destination}\nReservas: ${manifest.counts.bookings}; fotografías: ${manifest.counts.photos}. Configura DATA_DIR con el padre de este directorio de modo antes de iniciar la API.`)
    }
  } catch (error) { console.error(`No se restauró el respaldo: ${error.message}`); process.exitCode = 1 }
}
