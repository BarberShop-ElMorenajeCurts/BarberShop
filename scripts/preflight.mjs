import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLocalHost, loadConfig } from '../server/config.mjs'

const hasText = value => typeof value === 'string' && value.trim().length > 0
const hasOuterWhitespace = value => typeof value === 'string' && value !== value.trim()
const emailPattern = /^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/
const callbackPath = '/api/auth/google/callback'

/** Pure offline diagnosis. The result intentionally contains no configuration values. */
export function checkConfiguration(env = {}, { requireLive = false, cwd = process.cwd() } = {}) {
  const issues = []
  const issue = (code, message, severity = 'error') => issues.push({ code, severity, message })
  const pending = (code, message) => issue(code, message, requireLive ? 'error' : 'warning')
  const explicitMode = hasText(env.APP_MODE)
  if (explicitMode && !['setup', 'demo', 'live'].includes(env.APP_MODE)) issue('INVALID_MODE', 'APP_MODE debe seleccionar setup, demo o live.')

  let origin = null
  if (!hasText(env.APP_ORIGIN)) pending('ORIGIN_MISSING', 'Define APP_ORIGIN explícitamente con el origen que utilizará el navegador.')
  try {
    origin = new URL(hasText(env.APP_ORIGIN) ? env.APP_ORIGIN : 'http://localhost:8443')
    if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash || hasOuterWhitespace(env.APP_ORIGIN)) {
      origin = null
      issue('INVALID_ORIGIN', 'APP_ORIGIN debe ser un origen HTTP/HTTPS sin ruta, credenciales, consulta ni fragmento.')
    }
  } catch { issue('INVALID_ORIGIN', 'APP_ORIGIN no tiene un formato de origen HTTP/HTTPS válido.') }

  const credentialFields = [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID_MISSING', 'Completa GOOGLE_CLIENT_ID con el cliente OAuth web del proyecto.'],
    ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET_MISSING', 'Completa GOOGLE_CLIENT_SECRET únicamente en el entorno privado del servidor.'],
  ]
  for (const [field, code, message] of credentialFields) {
    if (!hasText(env[field])) pending(code, message)
    else if (hasOuterWhitespace(env[field])) issue(`${field}_WHITESPACE`, `${field} no debe contener espacios al principio o al final.`)
  }

  let keyValid = false
  if (!hasText(env.TOKEN_ENCRYPTION_KEY)) pending('ENCRYPTION_KEY_MISSING', 'Genera y conserva TOKEN_ENCRYPTION_KEY: 32 bytes aleatorios codificados en base64.')
  else {
    const value = env.TOKEN_ENCRYPTION_KEY
    keyValid = /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32 && Buffer.from(value, 'base64').toString('base64') === value
    if (!keyValid) issue('INVALID_ENCRYPTION_KEY', 'TOKEN_ENCRYPTION_KEY debe ser base64 válido y representar exactamente 32 bytes; no reutilices una contraseña.')
  }

  const subPresent = hasText(env.ADMIN_GOOGLE_SUB), emailPresent = hasText(env.ADMIN_GOOGLE_EMAIL)
  if (!subPresent && !emailPresent) pending('ADMIN_IDENTITY_MISSING', 'Configura ADMIN_GOOGLE_SUB o ADMIN_GOOGLE_EMAIL para restringir el acceso al propietario.')
  if (subPresent && (hasOuterWhitespace(env.ADMIN_GOOGLE_SUB) || !/^[A-Za-z0-9_-]{1,255}$/.test(env.ADMIN_GOOGLE_SUB))) issue('INVALID_ADMIN_SUB', 'ADMIN_GOOGLE_SUB no tiene un formato de identificador válido.')
  if (emailPresent && (hasOuterWhitespace(env.ADMIN_GOOGLE_EMAIL) || !emailPattern.test(env.ADMIN_GOOGLE_EMAIL))) issue('INVALID_ADMIN_EMAIL', 'ADMIN_GOOGLE_EMAIL debe ser un correo válido, sin nombres visibles ni espacios adicionales.')
  if (subPresent && emailPresent) issue('ADMIN_SUB_PRECEDENCE', 'ADMIN_GOOGLE_SUB tiene prioridad; verifica que ambos identificadores correspondan al mismo propietario.', 'warning')

  if (hasText(env.EMAIL_ENABLED) && !['true', 'false'].includes(env.EMAIL_ENABLED)) issue('INVALID_EMAIL_FLAG', 'EMAIL_ENABLED solo admite true o false en minúsculas.')
  if (env.EMAIL_ENABLED !== 'true') pending('EMAIL_DISABLED', 'Establece EMAIL_ENABLED=true y autoriza gmail.send antes de las pruebas reales de correo.')

  let callbackValid = false
  if (!hasText(env.GOOGLE_REDIRECT_URI)) issue('CALLBACK_DERIVED', 'GOOGLE_REDIRECT_URI no está definida: el servidor deriva el callback desde APP_ORIGIN. Registra exactamente la ruta /api/auth/google/callback en el cliente OAuth.', 'warning')
  try {
    const callback = new URL(hasText(env.GOOGLE_REDIRECT_URI) ? env.GOOGLE_REDIRECT_URI : `${origin?.origin || 'http://localhost:8443'}${callbackPath}`)
    callbackValid = Boolean(origin && ['http:', 'https:'].includes(callback.protocol) && callback.origin === origin.origin && callback.pathname === callbackPath && !callback.username && !callback.password && !callback.search && !callback.hash && !hasOuterWhitespace(env.GOOGLE_REDIRECT_URI))
    if (!callbackValid) issue('CALLBACK_MISMATCH', 'GOOGLE_REDIRECT_URI debe usar el mismo origen que APP_ORIGIN y terminar exactamente en /api/auth/google/callback, sin consulta ni fragmento.')
  } catch { issue('INVALID_CALLBACK', 'GOOGLE_REDIRECT_URI no es una URL de callback válida.') }

  for (const field of ['PORT', 'API_PORT']) {
    if (hasText(env[field]) && (!/^\d+$/.test(env[field]) || !Number.isInteger(Number(env[field])) || Number(env[field]) < 1 || Number(env[field]) > 65535)) issue('INVALID_PORT', `${field} debe ser un puerto entero entre 1 y 65535.`)
  }
  if (hasText(env.GOOGLE_POLL_INTERVAL_MS) && (!Number.isFinite(Number(env.GOOGLE_POLL_INTERVAL_MS)) || Number(env.GOOGLE_POLL_INTERVAL_MS) <= 0)) issue('INVALID_POLL_INTERVAL', 'GOOGLE_POLL_INTERVAL_MS debe ser un número positivo y finito.')
  else if (hasText(env.GOOGLE_POLL_INTERVAL_MS) && Number(env.GOOGLE_POLL_INTERVAL_MS) < 10000) issue('POLL_INTERVAL_CLAMPED', 'El servidor ajusta GOOGLE_POLL_INTERVAL_MS a un mínimo de 10000 ms.', 'warning')

  let config = null
  try { config = loadConfig({ ...env }, cwd) }
  catch { issue('SERVER_CONFIG_REJECTED', 'El servidor rechaza esta configuración. Corrige el modo, origen y las restricciones locales de demo indicadas en la guía.') }

  if (origin && config?.mode === 'live' && origin.protocol !== 'https:' && !isLocalHost(origin.hostname)) issue('PUBLIC_HTTPS_REQUIRED', 'La operación real fuera de localhost requiere APP_ORIGIN con HTTPS.')
  // loadConfig can reject public HTTP before returning a mode. Report the actionable reason too.
  if (origin && env.APP_MODE === 'live' && origin.protocol !== 'https:' && !isLocalHost(origin.hostname) && !issues.some(v => v.code === 'PUBLIC_HTTPS_REQUIRED')) issue('PUBLIC_HTTPS_REQUIRED', 'La operación real fuera de localhost requiere APP_ORIGIN con HTTPS.')
  if (config?.mode === 'demo') {
    issue('DEMO_NOT_GOOGLE', 'La demostración es local y simulada; no comprueba conexión, permisos ni entrega de Google/Gmail.', 'warning')
    if (hasText(env.API_HOST) && !isLocalHost(env.API_HOST)) issue('DEMO_API_HOST_NOT_LOCAL', 'API_HOST debe ser loopback cuando se usa dev:api en modo demo.')
  }
  if (requireLive && config?.mode !== 'live') issue('LIVE_MODE_REQUIRED', 'Las pruebas reales requieren modo efectivo live; setup y demo no certifican esa preparación.')

  const requiredPresent = hasText(env.APP_ORIGIN) && credentialFields.every(([field]) => hasText(env[field]) && !hasOuterWhitespace(env[field])) && keyValid && (subPresent || emailPresent) && env.EMAIL_ENABLED === 'true' && callbackValid
  const liveReady = Boolean(config?.mode === 'live' && requiredPresent && !issues.some(v => v.severity === 'error'))
  const ok = !issues.some(v => v.severity === 'error')
  return { ok, liveReady, mode: config?.mode || null, issues }
}

export function formatReport(result, { requireLive = false } = {}) {
  const lines = ['Comprobación offline de configuración · ElMorenaje Cuts', 'No se muestran valores de variables ni credenciales.']
  for (const item of result.issues) lines.push(`[${item.severity === 'error' ? 'ERROR' : 'PENDIENTE'}] ${item.message}`)
  if (result.liveReady) lines.push('[OK] Requisitos locales aptos para preparar pruebas reales. La cuenta, los calendarios y el correo siguen sin comprobar.')
  else if (result.ok && !requireLive) lines.push('[OK LOCAL] Configuración válida para preparación local; faltan requisitos para pruebas reales.')
  else lines.push('[NO APTO] Corrige los requisitos indicados antes de continuar.')
  lines.push('Este diagnóstico no contacta Google, no inicia sesión, no abre bases de datos y no crea eventos ni envía correos.', 'Un resultado apto no demuestra acceso renovable, permisos de calendarios, zona horaria remota ni entrega de Gmail. Esas evidencias pertenecen a C4 real/C7.')
  return `${lines.join('\n')}\n`
}

/** CLI entry point; tests provide synthetic env and never read a real .env. */
export function runPreflight({ argv = [], env, cwd = process.cwd(), write = value => process.stdout.write(value) } = {}) {
  if (argv.includes('--help')) {
    write('Uso: node scripts/preflight.mjs [--live]\nValida el entorno offline; --live exige los requisitos locales de operación real. Nunca comprueba ni autoriza una conexión Google.\n')
    return 0
  }
  if (argv.some(arg => arg !== '--live')) { write('Argumento no admitido. Usa --help o --live.\n'); return 2 }
  if (env === undefined) {
    try { const filename = path.join(cwd, '.env'); if (existsSync(filename)) process.loadEnvFile(filename) }
    catch { write('[ERROR] No se pudo cargar .env. Revisa el formato y los permisos del archivo sin compartir sus valores.\n'); return 1 }
    env = process.env
  }
  const requireLive = argv.includes('--live'), result = checkConfiguration(env, { requireLive, cwd })
  write(formatReport(result, { requireLive }))
  return result.ok && (!requireLive || result.liveReady) ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runPreflight({ argv: process.argv.slice(2) })
