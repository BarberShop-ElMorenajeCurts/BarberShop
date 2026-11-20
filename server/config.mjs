import path from 'node:path'
import business from '../config/business.public.json' with { type: 'json' }

export const TWO_HOURS = 2 * 60 * 60 * 1000
export const DAY = 24 * 60 * 60 * 1000
export const TIME_ZONE = 'America/Curacao'
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.events']
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

export class Problem extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
export function assert(condition, code = 'VALIDATION_ERROR', message = 'Datos no válidos.', status = 400) {
  if (!condition) throw new Problem(status, code, message)
}
export const isLoopback = (address = '') => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
export const isLocalHost = (hostname) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:8443')
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.username || origin.password) throw new Error('APP_ORIGIN debe ser un origen HTTP/HTTPS sin ruta.')
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY ? Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64') : null
  const oauthConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && (env.ADMIN_GOOGLE_SUB || env.ADMIN_GOOGLE_EMAIL) && encryptionKey?.length === 32)
  const requestedMode = env.APP_MODE || (oauthConfigured ? 'live' : 'setup')
  if (!['setup', 'demo', 'live'].includes(requestedMode)) throw new Error('APP_MODE debe ser setup, demo o live.')
  const mode = requestedMode === 'live' && !oauthConfigured ? 'setup' : requestedMode
  const host = env.HOST || '127.0.0.1'
  if (mode === 'demo' && (!isLocalHost(origin.hostname) || !isLocalHost(host))) throw new Error('La demostración requiere APP_ORIGIN y HOST de loopback.')
  if (mode === 'live' && origin.protocol !== 'https:' && !isLocalHost(origin.hostname)) throw new Error('La operación pública real requiere APP_ORIGIN con HTTPS.')
  const dataRoot = path.resolve(cwd, env.DATA_DIR || '.data')
  const dataDir = path.join(dataRoot, mode === 'demo' ? 'demo' : 'live')
  const emailEnabled = env.EMAIL_ENABLED === 'true'
  return {
    mode, requestedMode, host, port: Number(env.PORT || 3001), origin: origin.origin,
    secureCookies: origin.protocol === 'https:', dataDir,
    distDir: path.resolve(cwd, 'dist'), mediaDir: path.join(dataDir, 'media'),
    oauthConfigured, encryptionKey, clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || `${origin.origin}/api/auth/google/callback`,
    adminSub: env.ADMIN_GOOGLE_SUB || '', adminEmail: (env.ADMIN_GOOGLE_EMAIL || '').toLowerCase(),
    emailEnabled, scopes: [...GOOGLE_SCOPES, ...(emailEnabled ? [GMAIL_SCOPE] : [])],
    pollInterval: Math.max(10000, Number(env.GOOGLE_POLL_INTERVAL_MS || 30000)),
  }
}

export function seedCatalog(demo = false) {
  if (!demo) {
    const catalog = structuredClone(business)
    return { settings: catalog.settings, services: catalog.services, barbers: catalog.barbers.map(barber => ({ ...barber, calendarId: '', weeklyHours: structuredClone(catalog.weeklyHours) })) }
  }
  const services = [
    ['fade', 'Fade Clásico', 'Classic Fade', 'Degradado limpio y preciso.', 'A clean, precise fade.', 45, 35, 'yellow'],
    ['beard', 'Perfilado de Barba', 'Beard Shaping', 'Diseño y tratamiento de barba.', 'Beard design and treatment.', 30, 25, 'red'],
    ['vip', 'Combo VIP', 'VIP Combo', 'Corte, barba y acabado premium.', 'Haircut, beard and premium finish.', 75, 55, 'blue'],
    ['design', 'Diseños Urbanos', 'Urban Designs', 'Freestyle personalizado.', 'Personalized freestyle.', 60, 45, 'yellow'],
  ].map(([id, es, en, des, den, durationMinutes, price, accent]) => ({ id, name: { es, en }, description: { es: des, en: den }, durationMinutes, price: demo ? price : null, currency: demo ? 'USD' : null, accent, active: true }))
  const weeklyHours = demo ? [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: weekday === 6 ? '17:00' : '19:00' })) : []
  return {
    settings: { name: 'ElMorenaje Cuts', timeZone: TIME_ZONE, whatsapp: '', instagram: '', tiktok: '', address: { es: '', en: '' }, mapsUrl: '', businessDataConfirmed: demo },
    services,
    barbers: ['El Morenaje', 'Carlos M.'].map((name, i) => ({ id: `barber-${i + 1}`, name, specialty: { es: 'Corte y barba', en: 'Haircuts and beard' }, serviceIds: services.map(s => s.id), active: true, calendarId: demo ? `demo-calendar-${i + 1}` : '', weeklyHours })),
  }
}
