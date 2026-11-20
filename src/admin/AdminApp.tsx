import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import type { AdminOverview, Block, Booking, BookingAction, CatalogUpdate, ManualBookingInput, Photo, PhotoSection, PhotoUpload, Session } from '../lib/contracts'
import { auditDetail, auditTitle, formatDate, initials, localDateTime, localToISO, remaining } from './utils'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'
import './admin.css'

type Tab = 'overview' | 'agenda' | 'catalog' | 'barbers' | 'hours' | 'photos'
const statusNames = { pending: 'Pendiente', confirmed: 'Confirmada', rejected: 'Rechazada', cancelled: 'Cancelada' }
const sectionNames: Record<PhotoSection, string> = { hero: 'Portada', gallery: 'Galería', barbers: 'Equipo' }
const FeedbackContext = createContext({ error: '', clearError: () => {} })

function message(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return 'Tu sesión terminó. Vuelve a ingresar con Google.'
  if (error instanceof ApiError && error.status === 409) return `${error.message} Actualiza los datos antes de volver a intentarlo.`
  return error instanceof Error ? error.message : 'No se pudo completar la operación. Inténtalo nuevamente.'
}

function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`adm-field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="adm-empty"><span aria-hidden="true">◇</span><p>{children}</p></div>
}

function Modal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const feedback = useContext(FeedbackContext)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    feedback.clearError()
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const nodes = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])
    nodes()[0]?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current()
      if (event.key !== 'Tab') return
      const elements = nodes()
      if (!elements.length) { event.preventDefault(); dialog.current?.focus(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [])
  return <div className="adm-modal-backdrop"><div className="adm-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <div className="adm-modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="adm-icon-button" aria-label="Cerrar" disabled={busy} onClick={onClose}>×</button></div>{feedback.error && <div className="adm-alert adm-alert--error" role="alert">{feedback.error}</div>}{children}
  </div></div>
}

type Mutate = (key: string, operation: () => Promise<unknown>, success: string) => Promise<boolean>

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [catalogDirty, setCatalogDirty] = useState(false)
  const [now, setNow] = useState(Date.now())

  const loadSession = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setSession(await api.session()) } catch (failure) { setError(message(failure)) } finally { setLoading(false) }
  }, [])
  const refresh = useCallback(async () => {
    const overview = await api.overview()
    setData(overview)
  }, [])
  useEffect(() => { void loadSession(); document.title = 'Administración · ElMorenaje Cuts' }, [loadSession])
  useEffect(() => {
    const callbackError = new URLSearchParams(window.location.search).get('error')
    if (callbackError) setError('No se pudo autorizar el acceso con Google. Comprueba que utilizas la cuenta administradora y vuelve a intentarlo.')
  }, [])
  useEffect(() => {
    if (!session?.authenticated) { setData(null); return }
    let active = true
    const update = async () => {
      try { const overview = await api.overview(); if (active) setData(overview) }
      catch (failure) { if (active) { setError(message(failure)); if (failure instanceof ApiError && failure.status === 401) setSession((current) => current ? { ...current, authenticated: false } : null) } }
    }
    void update()
    const interval = window.setInterval(() => void update(), 30_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [session?.authenticated])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer) }, [])

  const mutate: Mutate = async (key, operation, success) => {
    if (busy) return false
    setBusy(key); setError(''); setNotice('')
    try {
      await operation()
      setNotice(success)
      try { await refresh() } catch (failure) { setError(`La operación se guardó, pero no se pudo actualizar la vista. ${message(failure)}`) }
      return true
    } catch (failure) {
      setError(message(failure))
      if (failure instanceof ApiError && failure.status === 401) setSession((current) => current ? { ...current, authenticated: false } : null)
      if (failure instanceof ApiError && failure.status === 409) await refresh().catch(() => undefined)
      return false
    } finally { setBusy('') }
  }
  const loginDemo = async () => {
    setBusy('login'); setError('')
    try { setSession(await api.demoLogin()) } catch (failure) { setError(message(failure)) } finally { setBusy('') }
  }
  const logout = async () => {
    if (catalogDirty && !window.confirm('Hay cambios de configuración sin guardar. ¿Cerrar sesión y descartarlos?')) return
    setBusy('logout'); setError('')
    try { await api.logout(); setData(null); setSession(await api.session()) } catch (failure) { setError(message(failure)) } finally { setBusy('') }
  }
  const pending = data?.bookings.filter((booking) => booking.status === 'pending') ?? []
  const timeZone = data?.catalog.settings.timeZone || 'America/Curacao'

  const navigate = (next: Tab) => {
    if (next === tab) return
    if (catalogDirty && !window.confirm('Hay cambios de configuración sin guardar. ¿Cambiar de sección y descartarlos?')) return
    setCatalogDirty(false)
    setTab(next)
  }

  return <FeedbackContext.Provider value={{ error, clearError: () => setError('') }}><div className="admin-app">
    <a className="adm-skip" href="#admin-content">Ir al contenido</a>
    {(!session?.authenticated || loading) ? <div className="adm-login-wrap">
      <a className="adm-brand" href="/"><img src="/el-morenaje-logo.png" alt="" /><span>EL MORENAJE<small>CUTS · ADMINISTRACIÓN</small></span></a>
      <main id="admin-content" className="adm-login">
        <span className="adm-eyebrow">Portal interno</span><h1>La agenda.<br /><em>Bajo control.</em></h1>
        <p>Administra tus solicitudes, organiza las sillas y mantén las fotografías de tu barbería al día.</p>
        {loading ? <p role="status">Comprobando sesión…</p> : <>
          {session?.authConfigured && <a className="adm-button" href={api.googleLoginUrl}><span className="adm-google" aria-hidden="true">G</span>Continuar con Google <span aria-hidden="true">↗</span></a>}
          {session?.mode === 'demo' && <><div className="adm-banner">Demostración local. No envía correos ni crea citas en Google.</div><button className="adm-button" disabled={Boolean(busy)} onClick={() => void loginDemo()}>{busy ? 'Ingresando…' : 'Explorar el portal de demostración'}</button></>}
          {session && !session.authConfigured && session.mode !== 'demo' && <div className="adm-banner">El acceso de Google está pendiente de configuración. Las funciones administrativas se habilitarán al conectar la cuenta autorizada.</div>}
          {!session && <button className="adm-button adm-button--outline" onClick={() => void loadSession()}>Volver a intentar</button>}
        </>}
        {error && <div className="adm-alert adm-alert--error" role="alert">{error}</div>}
        <a className="adm-text-link" href="/">← Volver al sitio web</a>
      </main><div className="adm-login-footer">EL MORENAJE CUTS · CURAÇAO</div>
    </div> : <div className="adm-shell">
      <aside className="adm-sidebar">
        <a className="adm-brand" href="/"><img src="/el-morenaje-logo.png" alt="" /><span>EL MORENAJE<small>CUTS · ADMIN</small></span></a>
        <span className="adm-nav-label">Tu barbería</span>
        <nav aria-label="Administración">{([['overview', 'Resumen', '◈'], ['agenda', 'Agenda y solicitudes', '▦'], ['catalog', 'Negocio y servicios', '☷'], ['barbers', 'Barberos', '♙'], ['hours', 'Horarios', '◷'], ['photos', 'Fotografías', '▧']] as const).map(([key, label, icon]) => <button type="button" key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(key)}><span aria-hidden="true">{icon}</span>{label}{key === 'agenda' && pending.length > 0 && <small>{pending.length}</small>}</button>)}</nav>
        <div className="adm-sidebar-bottom"><a href="/" target="_blank" rel="noreferrer">Ver sitio web ↗</a><p>Horario de Curaçao<br /><strong>{timeZone}</strong></p><button type="button" onClick={() => void logout()} disabled={Boolean(busy)}>Cerrar sesión</button></div>
      </aside>
      <div className="adm-workspace">
        <header className="adm-topbar"><div><span className="adm-eyebrow">Portal del equipo</span><strong>{data?.catalog.settings.name || 'ElMorenaje Cuts'}</strong></div><div className="adm-account"><span className="adm-account-avatar">{initials(session.user?.name || 'Administrador')}</span><span>{session.user?.name || 'Administrador'}<small>{session.user?.email}</small></span></div></header>
        <main id="admin-content" className="adm-main" aria-busy={Boolean(busy)}>
          {session.mode === 'demo' && <div className="adm-banner">DEMOSTRACIÓN LOCAL · Los cambios se guardan en datos de prueba. No se envían correos ni se crean eventos reales.</div>}
          {session.mode === 'setup' && <div className="adm-banner">Preparación del negocio · Completa los servicios, horarios y calendarios antes de habilitar reservas reales.</div>}
          <div className="adm-announcements" aria-live="polite">{notice && <div className="adm-alert adm-alert--success">{notice}<button type="button" aria-label="Cerrar aviso" onClick={() => setNotice('')}>×</button></div>}</div>
          {error && <div className="adm-alert adm-alert--error" role="alert">{error}<button type="button" aria-label="Cerrar error" onClick={() => setError('')}>×</button></div>}
          {!data ? <section className="adm-panel"><h1>Cargando tu agenda</h1><p>Consultando solicitudes y configuración…</p><button className="adm-button adm-button--outline" onClick={() => void refresh().catch((failure) => setError(message(failure)))}>Actualizar</button></section> : <>
            {tab === 'overview' && <Overview data={data} now={now} timeZone={timeZone} onAgenda={() => setTab('agenda')} onCatalog={() => setTab('catalog')} />}
            {tab === 'agenda' && <Agenda data={data} now={now} timeZone={timeZone} busy={busy} mutate={mutate} />}
            {(['catalog', 'barbers', 'hours'] as Tab[]).includes(tab) && <CatalogEditor key={tab} initialSection={tab === 'barbers' ? 'barbers' : tab === 'hours' ? 'hours' : 'business'} data={data} busy={busy} mutate={mutate} onDirty={setCatalogDirty} />}
            {tab === 'photos' && <PhotoManager photos={data.catalog.photos} busy={busy} mutate={mutate} />}
          </>}
          <footer className="adm-footer"><span>ElMorenaje Cuts · Portal interno</span><button type="button" disabled={Boolean(busy) || !data} onClick={() => void refresh().then(() => setNotice('Agenda actualizada.')).catch((failure) => setError(message(failure)))}>Actualizar datos ↻</button></footer>
        </main>
      </div>
    </div>}
  </div></FeedbackContext.Provider>
}

function Overview({ data, now, timeZone, onAgenda, onCatalog }: { data: AdminOverview; now: number; timeZone: string; onAgenda: () => void; onCatalog: () => void }) {
  const today = localDateTime(new Date(now).toISOString(), timeZone).slice(0, 10)
  const pending = data.bookings.filter((booking) => booking.status === 'pending')
  const upcoming = data.bookings.filter((booking) => ['pending', 'confirmed'].includes(booking.status) && Date.parse(booking.startAt) >= now).sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 5)
  return <>
    <div className="adm-page-heading"><div><span className="adm-eyebrow">Todo en su sitio</span><h1>Tu día, <em>con flow.</em></h1><p>Solicitudes, próximas citas y estado de tu barbería.</p></div><button className="adm-button" onClick={onAgenda}>Abrir agenda <span aria-hidden="true">↗</span></button></div>
    <div className="adm-stats">{[['Por revisar', pending.length, 'Se confirman en 2 horas'], ['Citas de hoy', data.bookings.filter((booking) => ['pending', 'confirmed'].includes(booking.status) && localDateTime(booking.startAt, timeZone).slice(0, 10) === today).length, 'Pendientes y confirmadas'], ['Barberos activos', data.catalog.barbers.filter((barber) => barber.active).length, 'El equipo en la silla'], ['Por sincronizar', data.bookings.filter((booking) => booking.syncStatus !== 'synced').length, 'Revisar integración']].map(([label, count, hint]) => <article className="adm-stat" key={String(label)}><span>{label}</span><strong>{count}</strong><small>{hint}</small></article>)}</div>
    <div className="adm-two-columns"><section className="adm-panel"><div className="adm-panel-heading"><h2>Próximas citas</h2><button className="adm-text-link" onClick={onAgenda}>Ver agenda →</button></div>{upcoming.length ? <div className="adm-upcoming">{upcoming.map((booking) => <div key={booking.id}><span className="adm-customer-avatar">{initials(booking.customer.name)}</span><div><strong>{booking.customer.name}</strong><p>{data.catalog.services.find((service) => service.id === booking.serviceId)?.name.es || 'Servicio'} · {data.catalog.barbers.find((barber) => barber.id === booking.barberId)?.name || 'Barbero'}</p><small>{formatDate(booking.startAt, timeZone)}</small></div><span className={`adm-status adm-status--${booking.status}`}>{statusNames[booking.status]}</span></div>)}</div> : <Empty>Aún no hay citas próximas.</Empty>}</section>
    <section className="adm-panel"><h2>Estado del negocio</h2><div className="adm-integration-list">{[['Google Calendar', data.integration.googleConnected], ['Correo electrónico', data.integration.emailConfigured], ['Información del negocio', data.integration.businessReady]].map(([label, ready]) => <div key={String(label)}><span>{label}</span><strong className={ready ? 'adm-ready' : 'adm-pending'}>{ready ? 'Listo' : 'Pendiente'}</strong></div>)}</div>{data.integration.warnings.map((warning, index) => <p className="adm-inline-warning" key={index}>{warning}</p>)}<p className="adm-muted">Las reservas reales solo se habilitan con la configuración completa.</p><button className="adm-button adm-button--outline" onClick={onCatalog}>Revisar configuración</button></section></div>
    <section className="adm-panel"><h2>Actividad reciente</h2>{data.audit.length ? <ul className="adm-audit">{data.audit.slice(0, 12).map((item) => <li key={item.id}><span aria-hidden="true">•</span><div><strong>{auditTitle(item.action)}</strong><p>{auditDetail(item.detail)}</p></div><time dateTime={item.at}>{formatDate(item.at, timeZone, true)}</time></li>)}</ul> : <Empty>Los cambios de tu agenda aparecerán aquí.</Empty>}</section>
  </>
}

function Agenda({ data, now, timeZone, busy, mutate }: { data: AdminOverview; now: number; timeZone: string; busy: string; mutate: Mutate }) {
  const [status, setStatus] = useState('active')
  const [barber, setBarber] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ booking: Booking; action: BookingAction['action'] } | null>(null)
  const [manual, setManual] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [removeBlock, setRemoveBlock] = useState<Block | null>(null)
  const bookings = data.bookings.filter((booking) => (status === 'all' || (status === 'active' ? ['pending', 'confirmed'].includes(booking.status) : booking.status === status)) && (!barber || booking.barberId === barber) && (!date || localDateTime(booking.startAt, timeZone).slice(0, 10) === date) && (!search || `${booking.customer.name} ${booking.customer.email} ${booking.customer.phone}`.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => a.startAt.localeCompare(b.startAt))
  return <>
    <div className="adm-page-heading"><div><span className="adm-eyebrow">Cada silla cuenta</span><h1>Agenda y <em>solicitudes.</em></h1><p>Las solicitudes no rechazadas se confirman automáticamente a las dos horas.</p></div><div className="adm-actions"><button className="adm-button adm-button--outline" onClick={() => setBlocking(true)}>Bloquear horario</button><button className="adm-button" onClick={() => setManual(true)}>+ Registrar cita</button></div></div>
    <section className="adm-panel"><div className="adm-filters"><Field label="Buscar cliente"><input type="search" placeholder="Nombre, correo o teléfono" value={search} onChange={(event) => setSearch(event.target.value)} /></Field><Field label="Estado"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Pendientes y confirmadas</option><option value="all">Todos</option>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Barbero"><select value={barber} onChange={(event) => setBarber(event.target.value)}><option value="">Todo el equipo</option>{data.catalog.barbers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Fecha"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div>
    <div className="adm-list-heading"><h2>{bookings.length} {bookings.length === 1 ? 'cita' : 'citas'}</h2><span className="adm-muted">Hora local · {timeZone}</span></div>
    {bookings.length ? <div className="adm-bookings">{bookings.map((booking) => <article className="adm-booking" key={booking.id}><div className="adm-booking-top"><div><time dateTime={booking.startAt}>{formatDate(booking.startAt, timeZone)}</time><span className={`adm-status adm-status--${booking.status}`}>{statusNames[booking.status]}</span></div><small>#{booking.id.slice(0, 8)}</small></div><div className="adm-booking-content"><div><h3>{booking.customer.name}</h3><p>{data.catalog.services.find((item) => item.id === booking.serviceId)?.name.es || booking.serviceId}</p><p className="adm-muted">{data.catalog.barbers.find((item) => item.id === booking.barberId)?.name || booking.barberId} · {Math.round((Date.parse(booking.endAt) - Date.parse(booking.startAt)) / 60_000)} min</p></div><div className="adm-contact"><a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a><a href={`tel:${booking.customer.phone.replace(/[^\d+]/g, '')}`}>{booking.customer.phone}</a><small>Idioma de comunicaciones: {booking.language === 'en' ? 'Inglés' : 'Español'}</small></div></div>
      {booking.status === 'pending' && <p className="adm-countdown">◷ {remaining(booking.autoConfirmAt, now)}</p>}
      {booking.syncStatus !== 'synced' && <p className="adm-inline-warning">{booking.syncStatus === 'error' ? `Error de sincronización${booking.syncError ? `: ${booking.syncError}` : ''}` : 'Sincronización en proceso'}</p>}
      {booking.confirmationSource && <p className="adm-muted">Confirmación {booking.confirmationSource === 'automatic' ? 'automática' : 'manual'}</p>}
      {['pending', 'confirmed'].includes(booking.status) && <div className="adm-booking-actions">{booking.status === 'pending' && <><button className="adm-button adm-button--small" disabled={Boolean(busy)} onClick={() => setEditing({ booking, action: 'approve' })}>Aprobar ahora</button><button className="adm-button adm-button--small adm-button--danger" disabled={Boolean(busy)} onClick={() => setEditing({ booking, action: 'reject' })}>Rechazar</button></>}<button className="adm-button adm-button--small adm-button--outline" disabled={Boolean(busy)} onClick={() => setEditing({ booking, action: 'reschedule' })}>Reprogramar</button>{booking.status === 'confirmed' && <button className="adm-button adm-button--small adm-button--danger" disabled={Boolean(busy)} onClick={() => setEditing({ booking, action: 'cancel' })}>Cancelar cita</button>}</div>}
    </article>)}</div> : <Empty>No hay citas que coincidan con estos filtros.</Empty>}</section>
    <section className="adm-panel"><div className="adm-panel-heading"><h2>Horarios bloqueados</h2><button className="adm-text-link" onClick={() => setBlocking(true)}>Agregar bloqueo +</button></div>{data.blocks.filter((item) => !barber || item.barberId === barber).length ? <div className="adm-block-list">{data.blocks.filter((item) => !barber || item.barberId === barber).map((block) => <div key={block.id}><div><strong>{data.catalog.barbers.find((item) => item.id === block.barberId)?.name || block.barberId}</strong><p>{formatDate(block.startAt, timeZone)} → {formatDate(block.endAt, timeZone)}</p><small>{block.reason || 'Sin motivo indicado'}</small></div><button className="adm-button adm-button--small adm-button--outline" disabled={Boolean(busy)} onClick={() => setRemoveBlock(block)}>Habilitar horario</button></div>)}</div> : <Empty>No hay bloqueos registrados.</Empty>}</section>
    {editing && <BookingActionDialog booking={editing.booking} action={editing.action} data={data} timeZone={timeZone} busy={Boolean(busy)} onClose={() => setEditing(null)} onSubmit={async (action) => { if (await mutate(`booking-${editing.booking.id}`, () => api.bookingAction(editing.booking.id, action), 'La cita fue actualizada.')) setEditing(null) }} />}
    {manual && <ManualBookingDialog data={data} timeZone={timeZone} busy={Boolean(busy)} onClose={() => setManual(false)} onSubmit={async (input) => { if (await mutate('manual', () => api.manualBooking(input), 'La cita fue registrada.')) setManual(false) }} />}
    {blocking && <BlockDialog data={data} timeZone={timeZone} busy={Boolean(busy)} onClose={() => setBlocking(false)} onSubmit={async (input) => { if (await mutate('block', () => api.createBlock(input), 'Horario bloqueado.')) setBlocking(false) }} />}
    {removeBlock && <Modal title="Habilitar horario" busy={Boolean(busy)} onClose={() => setRemoveBlock(null)}><p>Se retirará este bloqueo. Las horas disponibles podrán volver a reservarse.</p><div className="adm-dialog-actions"><button className="adm-button adm-button--outline" disabled={Boolean(busy)} onClick={() => setRemoveBlock(null)}>Volver</button><button className="adm-button" disabled={Boolean(busy)} onClick={async () => { if (await mutate('remove-block', () => api.deleteBlock(removeBlock.id), 'Horario habilitado.')) setRemoveBlock(null) }}>Habilitar horario</button></div></Modal>}
  </>
}

function BookingActionDialog({ booking, action, data, timeZone, busy, onClose, onSubmit }: { booking: Booking; action: BookingAction['action']; data: AdminOverview; timeZone: string; busy: boolean; onClose: () => void; onSubmit: (input: BookingAction) => Promise<void> }) {
  const [start, setStart] = useState(localDateTime(booking.startAt, timeZone))
  const [barber, setBarber] = useState(booking.barberId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const titles = { approve: 'Aprobar solicitud', reject: 'Rechazar solicitud', cancel: 'Cancelar cita', reschedule: 'Reprogramar cita' }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try { await onSubmit({ action, expectedVersion: booking.version, reason: reason.trim(), ...(action === 'reschedule' ? { startAt: localToISO(start, timeZone), barberId: barber } : {}) }) } catch (failure) { setError(message(failure)) }
  }
  return <Modal title={titles[action]} busy={busy} onClose={onClose}><form onSubmit={(event) => void submit(event)}><p><strong>{booking.customer.name}</strong> · {formatDate(booking.startAt, timeZone)}</p>{action === 'approve' && <p>Se comprobará la disponibilidad y se notificará al cliente cuando la cita esté confirmada.</p>}{action === 'reject' && <p>Se liberará el horario y se notificará al cliente. Si ya vencieron las dos horas, actualiza la agenda y cancela la cita confirmada.</p>}{action === 'cancel' && <p>Se cancelará la cita y se anularán sus recordatorios.</p>}{action === 'reschedule' && <div className="adm-form-grid"><Field label={`Nueva fecha y hora · ${timeZone}`}><input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></Field><Field label="Barbero"><select required value={barber} onChange={(event) => setBarber(event.target.value)}>{data.catalog.barbers.filter((item) => item.active && item.serviceIds.includes(booking.serviceId)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field></div>}<Field label="Motivo o nota (opcional)"><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>{error && <p role="alert" className="adm-inline-warning">{error}</p>}<div className="adm-dialog-actions"><button type="button" className="adm-button adm-button--outline" disabled={busy} onClick={onClose}>Volver</button><button className={`adm-button ${['reject', 'cancel'].includes(action) ? 'adm-button--danger' : ''}`} disabled={busy}>{busy ? 'Guardando…' : titles[action]}</button></div></form></Modal>
}

function ManualBookingDialog({ data, timeZone, busy, onClose, onSubmit }: { data: AdminOverview; timeZone: string; busy: boolean; onClose: () => void; onSubmit: (input: ManualBookingInput) => Promise<void> }) {
  const [serviceId, setServiceId] = useState(data.catalog.services.find((item) => item.active)?.id || '')
  const [barberId, setBarberId] = useState('')
  const [start, setStart] = useState('')
  const [status, setStatus] = useState<'pending' | 'confirmed'>('confirmed')
  const [language, setLanguage] = useState<'es' | 'en'>('es')
  const [error, setError] = useState('')
  const key = useRef(crypto.randomUUID())
  const eligible = data.catalog.barbers.filter((item) => item.active && item.serviceIds.includes(serviceId))
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    const form = new FormData(event.currentTarget)
    try { await onSubmit({ serviceId, barberId: barberId || eligible[0]?.id || '', startAt: localToISO(start, timeZone), language, status, idempotencyKey: key.current, customer: { name: String(form.get('name') || '').trim(), email: String(form.get('email') || '').trim(), phone: String(form.get('phone') || '').trim() } }) } catch (failure) { setError(message(failure)) }
  }
  return <Modal title="Registrar cita manual" busy={busy} onClose={onClose}><form onSubmit={(event) => void submit(event)} onChange={() => { key.current = crypto.randomUUID() }}><p className="adm-muted">Registra una cita acordada con el cliente. Se comprobarán los conflictos de agenda.</p><div className="adm-form-grid"><Field label="Nombre del cliente"><input name="name" required maxLength={100} autoComplete="name" /></Field><Field label="Correo"><input name="email" type="email" required maxLength={254} autoComplete="email" /></Field><Field label="Teléfono"><input name="phone" type="tel" required maxLength={30} autoComplete="tel" /></Field><Field label="Idioma del cliente"><select value={language} onChange={(event) => setLanguage(event.target.value as 'es' | 'en')}><option value="es">Español</option><option value="en">Inglés</option></select></Field><Field label="Servicio"><select required value={serviceId} onChange={(event) => { setServiceId(event.target.value); setBarberId('') }}><option value="" disabled>Selecciona</option>{data.catalog.services.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name.es} · {item.durationMinutes === null ? 'Duración por confirmar' : `${item.durationMinutes} min`}</option>)}</select></Field><Field label="Barbero"><select required value={barberId || eligible[0]?.id || ''} onChange={(event) => setBarberId(event.target.value)}><option value="" disabled>Selecciona</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label={`Fecha y hora · ${timeZone}`}><input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></Field><Field label="Estado inicial"><select value={status} onChange={(event) => setStatus(event.target.value as 'pending' | 'confirmed')}><option value="confirmed">Confirmada</option><option value="pending">Pendiente · confirma en 2 horas</option></select></Field></div>{error && <p className="adm-inline-warning" role="alert">{error}</p>}<div className="adm-dialog-actions"><button type="button" className="adm-button adm-button--outline" onClick={onClose} disabled={busy}>Volver</button><button className="adm-button" disabled={busy || !eligible.length || !serviceId}>{busy ? 'Registrando…' : 'Registrar cita'}</button></div></form></Modal>
}

function BlockDialog({ data, timeZone, busy, onClose, onSubmit }: { data: AdminOverview; timeZone: string; busy: boolean; onClose: () => void; onSubmit: (input: Omit<Block, 'id'>) => Promise<void> }) {
  const [error, setError] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    const form = new FormData(event.currentTarget)
    try {
      const startAt = localToISO(String(form.get('start')), timeZone)
      const endAt = localToISO(String(form.get('end')), timeZone)
      if (endAt <= startAt) throw new Error('El fin del bloqueo debe ser posterior al inicio.')
      await onSubmit({ barberId: String(form.get('barber')), startAt, endAt, reason: String(form.get('reason') || '').trim() })
    } catch (failure) { setError(message(failure)) }
  }
  return <Modal title="Bloquear horario" busy={busy} onClose={onClose}><form onSubmit={(event) => void submit(event)}><p className="adm-muted">Este intervalo dejará de ofrecerse para nuevas reservas. Hora local: {timeZone}.</p><div className="adm-form-grid"><Field label="Barbero"><select required name="barber"><option value="">Selecciona</option>{data.catalog.barbers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Motivo"><input name="reason" maxLength={200} placeholder="Descanso, ausencia…" /></Field><Field label="Desde"><input required type="datetime-local" name="start" /></Field><Field label="Hasta"><input required type="datetime-local" name="end" /></Field></div>{error && <p className="adm-inline-warning" role="alert">{error}</p>}<div className="adm-dialog-actions"><button type="button" className="adm-button adm-button--outline" disabled={busy} onClick={onClose}>Volver</button><button className="adm-button" disabled={busy}>{busy ? 'Guardando…' : 'Bloquear horario'}</button></div></form></Modal>
}

type CatalogSection = 'business' | 'services' | 'barbers' | 'hours'

function catalogDraft(data: AdminOverview): CatalogUpdate {
  return structuredClone({ expectedRevision: data.catalog.revision, settings: data.catalog.settings, services: data.catalog.services, barbers: data.catalog.barbers })
}

function catalogIssue(draft: CatalogUpdate): { section: CatalogSection; message: string } | null {
  if (!draft.settings.name.trim()) return { section: 'business', message: 'Completa el nombre del negocio.' }
  if (draft.settings.whatsapp && !/^\+?\d{7,20}$/.test(draft.settings.whatsapp.trim())) return { section: 'business', message: 'WhatsApp necesita el número internacional, sin espacios. Ejemplo: +59996768925.' }
  for (const [label, value] of [['Google Maps', draft.settings.mapsUrl], ['Instagram', draft.settings.instagram], ['TikTok', draft.settings.tiktok], ['Facebook', draft.settings.facebook]] as const) {
    if (!value?.trim()) continue
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error() }
    catch { return { section: 'business', message: `Introduce un enlace HTTPS válido para ${label}.` } }
  }
  for (let index = 0; index < draft.services.length; index++) {
    const service = draft.services[index]
    const name = service.name.es || `Servicio ${index + 1}`
    if (!service.name.es.trim() || !service.name.en.trim()) return { section: 'services', message: `${name}: completa el nombre en español e inglés.` }
    if (service.durationMinutes !== null && (!Number.isInteger(service.durationMinutes) || service.durationMinutes < 5 || service.durationMinutes > 480)) return { section: 'services', message: `${name}: la duración debe ser un número entero entre 5 y 480 minutos.` }
    if (service.price !== null && (!Number.isFinite(service.price) || service.price < 0)) return { section: 'services', message: `${name}: introduce un precio válido.` }
  }
  const calendars = new Set<string>()
  for (let index = 0; index < draft.barbers.length; index++) {
    const barber = draft.barbers[index]
    if (!barber.name.trim()) return { section: 'barbers', message: `Completa el nombre del barbero ${index + 1}.` }
    const calendar = barber.calendarId.trim()
    if (calendar && calendars.has(calendar)) return { section: 'barbers', message: `${barber.name}: cada barbero necesita un calendario de Google diferente.` }
    if (calendar) calendars.add(calendar)
    for (let position = 0; position < barber.weeklyHours.length; position++) {
      const hours = barber.weeklyHours[position]
      if (!hours.start || !hours.end || hours.start >= hours.end) return { section: 'hours', message: `${barber.name}: la hora de cierre debe ser posterior a la apertura en cada intervalo.` }
      if (barber.weeklyHours.some((other, otherPosition) => otherPosition > position && other.weekday === hours.weekday && other.start < hours.end && other.end > hours.start)) return { section: 'hours', message: `${barber.name}: hay intervalos superpuestos. Ajusta las horas para que no coincidan.` }
    }
  }
  return null
}

function CatalogEditor({ data, busy, mutate, onDirty, initialSection }: { data: AdminOverview; busy: string; mutate: Mutate; onDirty: (dirty: boolean) => void; initialSection: CatalogSection }) {
  const [draft, setDraft] = useState<CatalogUpdate>(() => catalogDraft(data))
  const [dirty, setDirty] = useState(false)
  const [section, setSection] = useState<CatalogSection>(initialSection)
  const [validationError, setValidationError] = useState('')
  const validationAlert = useRef<HTMLDivElement>(null)
  const stale = dirty && data.catalog.revision !== draft.expectedRevision
  useEffect(() => { if (!dirty) setDraft(catalogDraft(data)) }, [data, dirty])
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => { if (validationError) validationAlert.current?.focus() }, [validationError])
  const update = (work: (next: CatalogUpdate) => void) => { setDraft((previous) => { const next = structuredClone(previous); work(next); return next }); setDirty(true); setValidationError('') }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const issue = catalogIssue(draft)
    if (issue) { setSection(issue.section); setValidationError(issue.message); return }
    if (stale) return
    if (await mutate('catalog', () => api.updateCatalog(draft), 'Configuración guardada.')) setDirty(false)
  }
  const addService = () => update((next) => next.services.push({ id: `service-${crypto.randomUUID()}`, name: { es: '', en: '' }, description: { es: '', en: '' }, durationMinutes: null, price: null, currency: null, accent: 'yellow', active: true }))
  const addBarber = () => update((next) => next.barbers.push({ id: `barber-${crypto.randomUUID()}`, name: '', specialty: { es: '', en: '' }, serviceIds: next.services.filter(service => service.active).map(service => service.id), active: true, calendarId: '', weeklyHours: [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '21:00' })) }))
  return <>
    <div className="adm-page-heading"><div><span className="adm-eyebrow">La base de tu barbería</span><h1>{section === 'hours' ? <>Tus <em>horarios.</em></> : section === 'barbers' ? <>Tu <em>equipo.</em></> : <>Negocio y <em>servicios.</em></>}</h1><p>Actualiza la información del sitio y la disponibilidad del equipo desde aquí.</p></div>{dirty && <span className="adm-unsaved">Cambios sin guardar</span>}</div>
    <form onSubmit={(event) => void save(event)}><fieldset className="adm-form-body" disabled={Boolean(busy)}>{validationError && <div className="adm-alert adm-alert--error" role="alert" tabIndex={-1} ref={validationAlert}>{validationError}</div>}{stale && <div className="adm-banner" role="alert">La configuración cambió en otra sesión. Tus cambios siguen aquí; revisa las diferencias y usa «Descartar cambios» para cargar la versión actual antes de volver a editar.</div>}<div className="adm-subnav" role="group" aria-label="Secciones de configuración">{([['business', 'Datos del negocio'], ['services', 'Servicios'], ['barbers', 'Barberos'], ['hours', 'Horarios semanales']] as const).map(([key, label]) => <button type="button" className={section === key ? 'active' : ''} aria-pressed={section === key} onClick={() => setSection(key)} key={key}>{label}</button>)}</div>
    {section === 'business' && <section className="adm-panel"><h2>Datos del negocio</h2><div className="adm-form-grid"><Field label="Nombre comercial"><input required value={draft.settings.name} maxLength={100} onChange={(event) => update((next) => { next.settings.name = event.target.value })} /></Field><Field label="Zona horaria"><select value={draft.settings.timeZone} onChange={(event) => update((next) => { next.settings.timeZone = event.target.value })}><option value="America/Curacao">Curaçao · America/Curacao</option></select></Field><Field label="WhatsApp" hint="Número internacional, con código de país. Ejemplo de formato: +599…"><input type="tel" value={draft.settings.whatsapp} maxLength={30} onChange={(event) => update((next) => { next.settings.whatsapp = event.target.value })} /></Field><Field label="Enlace de Google Maps"><input type="url" value={draft.settings.mapsUrl} onChange={(event) => update((next) => { next.settings.mapsUrl = event.target.value })} placeholder="https://…" /></Field><Field label="Instagram · enlace completo"><input type="url" value={draft.settings.instagram} onChange={(event) => update((next) => { next.settings.instagram = event.target.value })} placeholder="https://instagram.com/…" /></Field><Field label="TikTok · enlace completo"><input type="url" value={draft.settings.tiktok} onChange={(event) => update((next) => { next.settings.tiktok = event.target.value })} placeholder="https://tiktok.com/@…" /></Field><Field label="Facebook · enlace completo"><input type="url" value={draft.settings.facebook ?? ''} onChange={(event) => update((next) => { next.settings.facebook = event.target.value })} placeholder="https://facebook.com/…" /></Field><Field label="Dirección · español"><textarea rows={2} value={draft.settings.address.es} maxLength={300} onChange={(event) => update((next) => { next.settings.address.es = event.target.value })} /></Field><Field label="Dirección · inglés"><textarea rows={2} value={draft.settings.address.en} maxLength={300} onChange={(event) => update((next) => { next.settings.address.en = event.target.value })} /></Field></div><label className="adm-check adm-confirm-data"><input type="checkbox" checked={draft.settings.businessDataConfirmed} onChange={(event) => update((next) => { next.settings.businessDataConfirmed = event.target.checked })} /><span>Confirmo que los datos comerciales, servicios y horarios son definitivos.<small>Las reservas reales también requieren la integración de Google y correo lista.</small></span></label></section>}
    {section === 'services' && <section className="adm-panel"><div className="adm-panel-heading"><h2>Servicios · {draft.services.length}</h2><button type="button" className="adm-button adm-button--small" onClick={addService}>+ Agregar servicio</button></div>{!draft.services.length && <Empty>Agrega el primer servicio de tu barbería.</Empty>}{draft.services.map((service, index) => <fieldset className="adm-editor-card" key={service.id}><legend>{service.name.es || `Servicio ${index + 1}`}</legend><div className="adm-form-grid"><Field label="Nombre · español"><input required maxLength={100} value={service.name.es} onChange={(event) => update((next) => { next.services[index].name.es = event.target.value })} /></Field><Field label="Nombre · inglés"><input required maxLength={100} value={service.name.en} onChange={(event) => update((next) => { next.services[index].name.en = event.target.value })} /></Field><Field label="Descripción · español"><textarea rows={2} maxLength={500} value={service.description.es} onChange={(event) => update((next) => { next.services[index].description.es = event.target.value })} /></Field><Field label="Descripción · inglés"><textarea rows={2} maxLength={500} value={service.description.en} onChange={(event) => update((next) => { next.services[index].description.en = event.target.value })} /></Field><Field label="Duración · minutos" hint="Deja vacío hasta confirmar. Las reservas necesitan una duración válida."><input type="number" min={5} max={480} step={1} value={service.durationMinutes ?? ''} onChange={(event) => update((next) => { next.services[index].durationMinutes = event.target.value === '' ? null : Number(event.target.value) })} /></Field><Field label="Precio" hint="Deja vacío si aún está por definir."><input type="number" min={0} step="0.01" value={service.price ?? ''} onChange={(event) => update((next) => { next.services[index].price = event.target.value === '' ? null : Number(event.target.value) })} /></Field><Field label="Moneda · código ISO" hint="La moneda inicial del negocio es ANG. Puedes ajustarla aquí."><input value={service.currency ?? ''} maxLength={3} pattern="[A-Za-z]{3}" onChange={(event) => update((next) => { next.services[index].currency = event.target.value.toUpperCase() || null })} /></Field><Field label="Color de acento"><select value={service.accent} onChange={(event) => update((next) => { next.services[index].accent = event.target.value as typeof service.accent })}><option value="yellow">Amarillo</option><option value="red">Rojo</option><option value="blue">Azul</option></select></Field></div><label className="adm-check"><input type="checkbox" checked={service.active} onChange={(event) => update((next) => { next.services[index].active = event.target.checked })} />Servicio activo</label>{!data.catalog.services.some(item => item.id === service.id) && <button type="button" className="adm-button adm-button--small adm-button--danger" onClick={() => update(next => { next.services.splice(index, 1); next.barbers.forEach(item => { item.serviceIds = item.serviceIds.filter(id => id !== service.id) }) })}>Quitar borrador de servicio</button>}</fieldset>)}</section>}
    {section === 'barbers' && <section className="adm-panel"><div className="adm-panel-heading"><h2>Barberos · {draft.barbers.length}</h2><button type="button" className="adm-button adm-button--small" onClick={addBarber}>+ Agregar barbero</button></div><p className="adm-muted">Agrega profesionales, cambia sus datos y asigna los servicios que realizan. Desactivar un barbero lo retira de nuevas reservas y conserva sus citas e historial. El ID del calendario puede completarse después.</p>{!draft.barbers.length && <Empty>Agrega los profesionales y sus horarios.</Empty>}{draft.barbers.map((barber, index) => <fieldset className="adm-editor-card" key={barber.id}><legend>{barber.name || `Barbero ${index + 1}`}</legend><div className="adm-form-grid"><Field label="Nombre"><input required maxLength={100} value={barber.name} onChange={(event) => update((next) => { next.barbers[index].name = event.target.value })} /></Field><Field label="ID del calendario de Google" hint="Google Calendar → Configuración del calendario → Integrar calendario."><input value={barber.calendarId} maxLength={254} onChange={(event) => update((next) => { next.barbers[index].calendarId = event.target.value })} /></Field><Field label="Especialidad · español"><input value={barber.specialty.es} maxLength={200} onChange={(event) => update((next) => { next.barbers[index].specialty.es = event.target.value })} /></Field><Field label="Especialidad · inglés"><input value={barber.specialty.en} maxLength={200} onChange={(event) => update((next) => { next.barbers[index].specialty.en = event.target.value })} /></Field></div><label className="adm-check"><input type="checkbox" checked={barber.active} onChange={(event) => update((next) => { next.barbers[index].active = event.target.checked })} />Barbero activo</label>{!data.catalog.barbers.some(item => item.id === barber.id) && <button type="button" className="adm-button adm-button--small adm-button--danger" onClick={() => update(next => { next.barbers.splice(index, 1) })}>Quitar borrador de barbero</button>}<h3 className="adm-form-subheading">Servicios que realiza</h3><div className="adm-checkbox-grid">{draft.services.map((service) => <label className="adm-check" key={service.id}><input type="checkbox" checked={barber.serviceIds.includes(service.id)} onChange={(event) => update((next) => { next.barbers[index].serviceIds = event.target.checked ? [...next.barbers[index].serviceIds, service.id] : next.barbers[index].serviceIds.filter((id) => id !== service.id) })} />{service.name.es || 'Servicio sin nombre'}</label>)}</div><p className="adm-muted">Horario: {barber.weeklyHours.length ? `${new Set(barber.weeklyHours.map(hours => hours.weekday)).size} días configurados` : 'Sin horario'}. Ajusta los días y las horas en «Horarios semanales».</p></fieldset>)}</section>}
    {section === 'hours' && <section className="adm-panel"><h2>Disponibilidad semanal</h2><WeeklyHoursEditor barbers={draft.barbers} disabled={Boolean(busy)} onChange={(index, hours) => update(next => { next.barbers[index].weeklyHours = hours })} /></section>}
    <div className="adm-savebar"><span>{dirty ? 'Tienes cambios sin guardar' : 'Configuración actual'}</span><button type="button" disabled={Boolean(busy)} className="adm-button adm-button--outline" onClick={() => { if (!dirty || window.confirm('¿Descartar los cambios sin guardar?')) { setDraft(catalogDraft(data)); setDirty(false); setValidationError('') } }}>Descartar cambios</button><button className="adm-button" disabled={Boolean(busy) || !dirty || stale}>{busy === 'catalog' ? 'Guardando…' : 'Guardar configuración'}</button></div></fieldset></form>
  </>
}

function PhotoManager({ photos, busy, mutate }: { photos: Photo[]; busy: string; mutate: Mutate }) {
  const [filter, setFilter] = useState<PhotoSection | 'all'>('all')
  const [editing, setEditing] = useState<Photo | 'new' | null>(null)
  const [removing, setRemoving] = useState<Photo | null>(null)
  const visible = photos.filter((photo) => filter === 'all' || photo.section === filter).sort((a, b) => a.sortOrder - b.sortOrder)
  return <>
    <div className="adm-page-heading"><div><span className="adm-eyebrow">El trabajo habla</span><h1>Tu <em>lookbook.</em></h1><p>Actualiza las fotografías de portada, galería y equipo.</p></div><button className="adm-button" onClick={() => setEditing('new')}>+ Agregar fotografía</button></div>
    <div className="adm-subnav" role="group" aria-label="Filtrar fotografías">{([['all', 'Todas'], ...Object.entries(sectionNames)] as [PhotoSection | 'all', string][]).map(([key, label]) => <button type="button" key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    {visible.length ? <div className="adm-photo-grid">{visible.map((photo) => <article className="adm-photo-card" key={photo.id}><img src={photo.url} alt={photo.alt.es} loading="lazy" /><div><span className="adm-eyebrow">{sectionNames[photo.section]} · Orden {photo.sortOrder}</span><h2>{photo.alt.es || 'Fotografía sin descripción'}</h2><p>{photo.alt.en || 'Falta descripción en inglés'}</p><div className="adm-actions"><button className="adm-button adm-button--small adm-button--outline" disabled={Boolean(busy)} onClick={() => setEditing(photo)}>Editar / reemplazar</button><button className="adm-button adm-button--small adm-button--danger" disabled={Boolean(busy)} onClick={() => setRemoving(photo)}>Retirar</button></div></div></article>)}</div> : <section className="adm-panel"><Empty>No hay fotografías publicadas en esta sección. Agrega una imagen para mostrarla en el sitio.</Empty></section>}
    {editing && <PhotoDialog photo={editing === 'new' ? null : editing} busy={Boolean(busy)} onClose={() => setEditing(null)} onSubmit={async (input, photo) => {
      const success = await mutate('photo', async () => {
        if (input.dataUrl) {
          if (photo) await api.updatePhoto(photo.id, input)
          else await api.uploadPhoto(input as PhotoUpload)
        } else if (photo) await api.updatePhoto(photo.id, { section: input.section, alt: input.alt, sortOrder: input.sortOrder })
      }, 'Fotografía guardada.')
      if (success) setEditing(null)
    }} />}
    {removing && <Modal title="Retirar fotografía" busy={Boolean(busy)} onClose={() => setRemoving(null)}><p>Esta fotografía dejará de mostrarse en {sectionNames[removing.section].toLowerCase()}. Si es la última, la galería quedará vacía o se mostrará el logotipo en portada o equipo.</p><div className="adm-dialog-actions"><button className="adm-button adm-button--outline" disabled={Boolean(busy)} onClick={() => setRemoving(null)}>Volver</button><button className="adm-button adm-button--danger" disabled={Boolean(busy)} onClick={async () => { if (await mutate('delete-photo', () => api.deletePhoto(removing.id), 'Fotografía retirada.')) setRemoving(null) }}>{busy ? 'Retirando…' : 'Retirar fotografía'}</button></div></Modal>}
  </>
}

function PhotoDialog({ photo, busy, onClose, onSubmit }: { photo: Photo | null; busy: boolean; onClose: () => void; onSubmit: (input: Omit<PhotoUpload, 'dataUrl'> & { dataUrl?: string }, photo: Photo | null) => Promise<void> }) {
  const [section, setSection] = useState<PhotoSection>(photo?.section ?? 'gallery')
  const [altEs, setAltEs] = useState(photo?.alt.es ?? '')
  const [altEn, setAltEn] = useState(photo?.alt.en ?? '')
  const [order, setOrder] = useState(photo?.sortOrder ?? 0)
  const [dataUrl, setDataUrl] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const fileSequence = useRef(0)
  const selectFile = async (file?: File) => {
    const sequence = ++fileSequence.current
    setError(''); setDataUrl(''); setReading(false)
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Elige una imagen JPEG, PNG o WebP.'); return }
    if (file.size > 5 * 1024 * 1024) { setError('La imagen supera el máximo de 5 MB.'); return }
    setReading(true)
    try {
      const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file) })
      if (sequence === fileSequence.current) setDataUrl(content)
    } catch (failure) { if (sequence === fileSequence.current) setError(message(failure)) }
    finally { if (sequence === fileSequence.current) setReading(false) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!photo && !dataUrl) { setError('Selecciona una imagen.'); return }
    await onSubmit({ section, alt: { es: altEs.trim(), en: altEn.trim() }, sortOrder: order, ...(dataUrl ? { dataUrl } : {}) }, photo)
  }
  return <Modal title={photo ? 'Editar fotografía' : 'Agregar fotografía'} busy={busy || reading} onClose={onClose}><form onSubmit={(event) => void submit(event)}><Field label={photo ? 'Reemplazar imagen (opcional)' : 'Imagen'} hint="JPEG, PNG o WebP · máximo 5 MB"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectFile(event.target.files?.[0])} /></Field>{(dataUrl || photo) && <img className="adm-photo-preview" src={dataUrl || photo?.url} alt="Vista previa de la fotografía seleccionada" />}{reading && <p role="status">Preparando imagen…</p>}<div className="adm-form-grid"><Field label="Sección"><select value={section} onChange={(event) => setSection(event.target.value as PhotoSection)}>{Object.entries(sectionNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Orden" hint="Los números menores se muestran primero."><input required type="number" min={0} max={10000} value={order} onChange={(event) => setOrder(Number(event.target.value))} /></Field><Field label="Descripción alternativa · español"><textarea required rows={2} maxLength={300} value={altEs} onChange={(event) => setAltEs(event.target.value)} /></Field><Field label="Descripción alternativa · inglés"><textarea required rows={2} maxLength={300} value={altEn} onChange={(event) => setAltEn(event.target.value)} /></Field></div>{error && <p className="adm-inline-warning" role="alert">{error}</p>}<div className="adm-dialog-actions"><button type="button" className="adm-button adm-button--outline" onClick={onClose} disabled={busy || reading}>Volver</button><button className="adm-button" disabled={busy || reading}>{busy ? 'Guardando…' : 'Guardar fotografía'}</button></div></form></Modal>
}
