import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { assert, Problem, TWO_HOURS, DAY, TIME_ZONE } from './config.mjs'
import { adminBooking, bookingInput, catalogInput, eventInterval, inputHash, instant, iso, localDay, localized, publicBooking, text, validateHorizon, windowFor, withinHours } from './validation.mjs'

const active = b => ['pending', 'confirmed'].includes(b.status)
const catalogRevision = catalog => createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
const intersects = (a, b, c, d) => a < d && b > c
const safeError = error => error?.code === 'GOOGLE_QUOTA' ? 'Cuota de Google alcanzada; se reintentará.' : error?.code === 'GOOGLE_CONCURRENT_CHANGE' ? 'Calendar cambió durante la operación; requiere reconciliación.' : error instanceof Problem ? error.message : 'No se pudo sincronizar con Google; se reintentará.'

export class BookingService {
  constructor(config, store, adapter, { now = Date.now } = {}) {
    this.config = config; this.store = store; this.adapter = adapter; this.now = now; this.tail = Promise.resolve()
    mkdirSync(config.mediaDir, { recursive: true, mode: 0o700 })
  }
  async exclusive(work) {
    const previous = this.tail
    let release
    this.tail = new Promise(resolve => { release = resolve })
    await previous
    try { return await work() } finally { release() }
  }
  integration() {
    const c = this.store.get('catalog'), services = c.services.filter(s => s.active), barbers = c.barbers.filter(b => b.active)
    const businessReady = c.settings.businessDataConfirmed && services.length > 0 && services.every(s => s.price !== null && s.currency && Number.isInteger(s.durationMinutes) && s.durationMinutes >= 5 && s.durationMinutes <= 480) && barbers.length > 0 && barbers.every(b => b.calendarId && b.weeklyHours.length > 0 && b.serviceIds.some(id => services.some(s => s.id === id)))
    const googleConnected = this.adapter.connected(), emailConfigured = this.adapter.emailConfigured()
    const warnings = []
    if (this.config.mode === 'demo') warnings.push('Demostración local: datos de ejemplo; no se crean eventos ni se envían correos reales.')
    if (this.config.mode === 'setup') warnings.push('Completa la configuración OAuth del servidor para habilitar la operación real.')
    if (!googleConnected) warnings.push('Conecta la cuenta administrativa de Google.')
    if (!emailConfigured) warnings.push('Habilita Gmail y autoriza el permiso de envío para recibir solicitudes reales.')
    if (!businessReady) warnings.push('Confirma datos comerciales, precios, calendarios y horarios desde Configuración.')
    const sync = this.store.get('sync.error'); if (sync) warnings.push(sync)
    if (this.store.db.prepare("SELECT id FROM jobs WHERE state IN ('failed','uncertain') LIMIT 1").get()) warnings.push('Hay comunicaciones o tareas que requieren revisión; consulta el historial.')
    return { googleConnected, emailConfigured, businessReady: Boolean(businessReady), warnings }
  }
  catalog(admin = false) {
    const c = this.store.get('catalog'), integration = this.integration()
    return { revision: catalogRevision(c), mode: this.config.mode, bookingEnabled: this.config.mode !== 'setup' && integration.googleConnected && integration.emailConfigured && integration.businessReady, settings: c.settings, services: admin ? c.services : c.services.filter(s => s.active), barbers: (admin ? c.barbers : c.barbers.filter(b => b.active)).map(b => admin ? b : (({ calendarId, ...publicBarber }) => publicBarber)(b)), photos: this.store.all('photos').sort((a, b) => a.sortOrder - b.sortOrder) }
  }
  overview() { return { catalog: this.catalog(true), bookings: this.store.bookings().map(adminBooking), blocks: this.store.all('blocks').map(({ calendarId, eventId, syncStatus, ...block }) => block), integration: this.integration(), audit: this.store.audits() } }
  requireReady() { assert(this.catalog().bookingEnabled, 'BOOKING_DISABLED', 'Las reservas todavía no están habilitadas. Contacta al negocio.', 503) }
  pair(serviceId, barberId) {
    const c = this.store.get('catalog'), service = c.services.find(s => s.id === serviceId && s.active), barber = c.barbers.find(b => b.id === barberId && b.active)
    assert(service && barber && barber.serviceIds.includes(service.id), 'INVALID_SERVICE', 'El servicio no está disponible con ese barbero.')
    assert(Number.isInteger(service.durationMinutes) && service.durationMinutes >= 5 && service.durationMinutes <= 480, 'SERVICE_NOT_CONFIGURED', 'Confirma la duración del servicio antes de reservar.', 503)
    return { service, barber }
  }
  localConflict(barberId, start, end, exclude = '') {
    return Boolean(this.store.overlaps(barberId, start, end, exclude) || this.store.all('blocks').some(b => b.barberId === barberId && intersects(start, end, Date.parse(b.startAt), Date.parse(b.endAt))))
  }
  remoteConflict(events, start, end, exclude = '') {
    return events.some(event => {
      if (event.status === 'cancelled' || event.transparency === 'transparent' || (exclude && event.extendedProperties?.private?.bookingId === exclude)) return false
      const interval = eventInterval(event)
      return interval && intersects(start, end, interval.start, interval.end)
    })
  }
  async available(serviceId, barberId, date) {
    this.requireReady()
    const { service, barber } = this.pair(serviceId, barberId), day = localDay(date), now = this.now()
    validateHorizon(day, now)
    assert(day + DAY > now, 'INVALID_DATE', 'La fecha ya pasó.')
    let busy
    try { busy = await this.adapter.busy(barber.calendarId, day, day + DAY) } catch { throw new Problem(503, 'AVAILABILITY_UNAVAILABLE', 'No se pudo comprobar Calendar. Inténtalo de nuevo.') }
    const slots = []
    for (const window of windowFor(date, barber.weeklyHours)) {
      for (let start = window.start; start + service.durationMinutes * 60000 <= window.end; start += 15 * 60000) {
        const end = start + service.durationMinutes * 60000
        if (start > now + TWO_HOURS && !this.localConflict(barberId, start, end) && !this.remoteConflict(busy, start, end)) slots.push({ startAt: iso(start), endAt: iso(end) })
      }
    }
    return { date, timeZone: TIME_ZONE, slots }
  }
  async checkSlot(barber, start, end, exclude = '', publicRequest = false) {
    assert(start > this.now(), 'APPOINTMENT_IN_PAST', 'La cita debe comenzar en el futuro.')
    if (publicRequest) {
      assert(start > this.now() + TWO_HOURS, 'BOOKING_TOO_SOON', 'Reserva con más de dos horas de anticipación o contacta al administrador.')
      validateHorizon(start, this.now())
      assert(withinHours(start, end, barber.weeklyHours), 'OUTSIDE_WORKING_HOURS', 'La hora no pertenece al horario disponible.')
    }
    assert(!this.localConflict(barber.id, start, end, exclude), 'SLOT_UNAVAILABLE', 'Este horario ya está ocupado.', 409)
    let busy
    try { busy = await this.adapter.busy(barber.calendarId, start, end) } catch { throw new Problem(503, 'AVAILABILITY_UNAVAILABLE', 'No se pudo comprobar Calendar. Inténtalo de nuevo.') }
    assert(!this.remoteConflict(busy, start, end, exclude), 'SLOT_UNAVAILABLE', 'Este horario ya está ocupado en Calendar.', 409)
  }
  async create(input, manual = false) {
    return this.exclusive(async () => {
      this.requireReady()
      const value = bookingInput(input, manual), hash = inputHash(value), existing = this.store.byIdempotency(value.idempotencyKey)
      if (existing) {
        assert(existing.hash === hash, 'IDEMPOTENCY_CONFLICT', 'El identificador ya fue utilizado para otra solicitud.', 409)
        if (existing.booking.status === 'pending' && !existing.booking.autoConfirmAt) await this.runForBooking(existing.booking.id, ['hold'])
        const b = this.store.booking(existing.booking.id)
        assert(b.syncStatus === 'synced', 'GOOGLE_SYNC_ERROR', 'La solicitud está retenida, pero Calendar aún no está sincronizado. Reintenta con la misma solicitud.', 503)
        return manual ? adminBooking(b) : publicBooking(b)
      }
      const { service, barber } = this.pair(value.serviceId, value.barberId), start = instant(value.startAt), end = start + service.durationMinutes * 60000
      if (manual && value.status === 'pending') assert(start > this.now() + TWO_HOURS, 'BOOKING_TOO_SOON', 'Para una cita manual próxima, elige confirmada.')
      await this.checkSlot(barber, start, end, '', !manual)
      const b = { ...value, id: randomUUID(), inputHash: hash, status: 'pending', syncStatus: 'pending', syncError: null, startAt: iso(start), endAt: iso(end), createdAt: iso(this.now()), autoConfirmAt: null, confirmationSource: null, version: 1, mode: this.config.mode, googleCalendarId: barber.calendarId, googleEventId: null, googleEtag: null, hadInvite: false, serviceName: service.name, pendingManualConfirmation: manual && value.status === 'confirmed' }
      this.store.transaction(() => {
        assert(!this.localConflict(barber.id, start, end), 'SLOT_UNAVAILABLE', 'Este horario ya está ocupado.', 409)
        this.store.saveBooking(b); this.store.job(`hold:${b.id}`, 'hold', b.id, this.now(), { version: b.version }); this.store.audit(manual ? 'booking.manual.created' : 'booking.requested', b.id, 'Intervalo retenido localmente; sincronización en curso.', this.now())
      })
      await this.runForBooking(b.id, ['hold'])
      let saved = this.store.booking(b.id)
      if (saved.pendingManualConfirmation && saved.syncStatus === 'synced') {
        this.store.job(`confirm:${saved.id}:${saved.version}:manual`, 'confirm', saved.id, this.now(), { version: saved.version, source: 'manual' })
        await this.runForBooking(saved.id, ['confirm']); saved = this.store.booking(b.id)
      }
      assert(saved.syncStatus === 'synced', 'GOOGLE_SYNC_ERROR', 'La solicitud está retenida, pero Calendar aún no está sincronizado. Reintenta con la misma solicitud.', 503)
      return manual ? adminBooking(saved) : publicBooking(saved)
    })
  }
  queueEmail(b, kind, due = this.now()) { this.store.job(`email:${b.id}:${b.version}:${kind}`, 'email', b.id, due, { version: b.version, kind }) }
  scheduleReminder(b) {
    this.store.cancelJobs(b.id, ['reminder'])
    const due = Date.parse(b.startAt) - DAY
    if (b.status === 'confirmed' && due > this.now()) this.store.job(`reminder:${b.id}:${b.version}`, 'reminder', b.id, due, { version: b.version, kind: 'reminder' })
  }
  async action(id, input) {
    return this.exclusive(async () => {
      assert(this.config.mode !== 'setup', 'SETUP_MODE', 'Activa el modo live después de configurar la integración.', 503)
      assert(input && ['approve', 'reject', 'cancel', 'reschedule'].includes(input.action) && Number.isInteger(input.expectedVersion), 'VALIDATION_ERROR', 'Acción no válida.')
      let b = this.store.booking(id); assert(b, 'NOT_FOUND', 'Reserva no encontrada.', 404)
      if (active(b) && b.googleEventId && b.syncStatus === 'synced') {
        const event = await this.adapter.getEvent(b.googleCalendarId, b.googleEventId)
        if (!event || event.status === 'cancelled') {
          const moved = await this.findMoved(b)
          if (moved) await this.applyRemote(moved.calendarId, moved.event)
          else this.externalCancel(b)
        } else if (event.etag !== b.googleEtag) await this.applyRemote(b.googleCalendarId, event)
        b = this.store.booking(id)
      }
      assert(b.version === input.expectedVersion, 'VERSION_CONFLICT', 'La reserva cambió. Actualiza la agenda.', 409)
      assert(active(b), 'INVALID_BOOKING_STATE', 'La reserva ya no está activa.', 409)
      const reason = input.reason == null ? '' : text(input.reason, 500, true)
      if (input.action === 'approve' || input.action === 'reject') {
        assert(b.status === 'pending', 'INVALID_BOOKING_STATE', 'La cita ya está confirmada; puedes cancelarla.', 409)
        if (input.action === 'reject') assert(!b.autoConfirmAt || this.now() < Date.parse(b.autoConfirmAt), 'REVIEW_DEADLINE_PASSED', 'El plazo de revisión terminó; utiliza cancelar.', 409)
      }
      if (input.action === 'approve') {
        assert(b.autoConfirmAt, 'SYNC_PENDING', 'Espera a que la retención se sincronice con Calendar.', 409)
        // An explicit approval resolves an early-start review; conflicts are still checked.
        b.reviewRequired = false; this.store.saveBooking(b)
        this.store.job(`confirm:${b.id}:${b.version}:manual`, 'confirm', b.id, this.now(), { version: b.version, source: this.now() >= Date.parse(b.autoConfirmAt) ? 'automatic' : 'manual' })
        await this.runForBooking(b.id, ['confirm'])
        return adminBooking(this.store.booking(b.id))
      }
      if (input.action === 'reschedule') {
        const destination = input.barberId || b.barberId, { barber, service } = this.pair(b.serviceId, destination), start = instant(input.startAt), end = start + service.durationMinutes * 60000
        if (b.status === 'pending') assert(start > this.now() + TWO_HOURS, 'BOOKING_TOO_SOON', 'Aprueba la pendiente antes de moverla a una hora próxima.')
        await this.checkSlot(barber, start, end, b.id)
        this.store.transaction(() => {
          assert(this.store.booking(b.id).version === b.version, 'VERSION_CONFLICT', 'La reserva cambió.', 409)
          b = { ...b, barberId: barber.id, startAt: iso(start), endAt: iso(end), version: b.version + 1, syncStatus: 'pending', syncError: null, reviewRequired: false }
          this.store.cancelJobs(b.id); this.store.saveBooking(b); this.store.job(`reschedule:${b.id}:${b.version}`, 'reschedule', b.id, this.now(), { version: b.version }); this.store.audit('booking.rescheduled', b.id, 'Cambio de fecha/barbero solicitado desde el portal.', this.now())
        })
        await this.runForBooking(b.id, ['reschedule'])
      } else {
        this.store.transaction(() => {
          b = { ...b, status: input.action === 'reject' ? 'rejected' : 'cancelled', version: b.version + 1, syncStatus: 'pending', syncError: null }
          this.store.cancelJobs(b.id); this.store.saveBooking(b); this.store.job(`remove:${b.id}:${b.version}`, 'remove', b.id, this.now(), { version: b.version, kind: b.status }); this.store.audit(`booking.${b.status}`, b.id, reason || 'Decisión desde el portal.', this.now())
        })
        await this.runForBooking(b.id, ['remove'])
      }
      return adminBooking(this.store.booking(b.id))
    })
  }
  async runForBooking(id, kinds) {
    for (const job of this.store.dueJobs(this.now()).filter(job => job.booking === id && kinds.includes(job.kind))) await this.execute(job)
  }
  async runJobs() {
    if (this.config.mode === 'setup') return
    return this.exclusive(async () => { for (const job of this.store.dueJobs(this.now())) await this.execute(job) })
  }
  async execute(job) {
    const claimed = this.store.db.prepare("UPDATE jobs SET state='running',attempts=attempts+1 WHERE id=? AND state='pending'").run(job.id)
    if (!claimed.changes) return
    let b = job.booking ? this.store.booking(job.booking) : null
    if (b && job.payload.version !== b.version) { this.store.finishJob(job.id); return }
    try {
      if (['hold', 'confirm', 'reschedule', 'remove'].includes(job.kind)) {
        if (!b) { this.store.finishJob(job.id); return }
        const c = this.store.get('catalog'), barber = c.barbers.find(v => v.id === b.barberId)
        assert(barber?.calendarId, 'BARBER_NOT_CONFIGURED', 'El barbero no tiene calendario.', 503)
        if (job.kind === 'remove') {
          await this.adapter.remove(b)
          b.syncStatus = 'synced'; b.syncError = null; this.store.saveBooking(b); this.queueEmail(b, job.payload.kind)
        } else {
          if (!active(b)) { this.store.finishJob(job.id); return }
          if (job.kind === 'confirm') {
            if (b.status !== 'pending') { this.store.finishJob(job.id); return }
            if (job.payload.source === 'automatic' && (!b.autoConfirmAt || this.now() < Date.parse(b.autoConfirmAt))) { this.store.finishJob(job.id); return }
            // Reconcile direct edits/deletions before the final conflict check and update.
            if (b.googleEventId) {
              const remote = await this.adapter.getEvent(b.googleCalendarId, b.googleEventId)
              if (!remote || remote.status === 'cancelled') {
                const linked = await this.findMoved(b)
                if (linked) await this.applyRemote(linked.calendarId, linked.event)
                else this.externalCancel(b)
                b = this.store.booking(b.id)
                if (!active(b) || b.version !== job.payload.version) { this.store.finishJob(job.id); return }
              } else if (remote.etag !== b.googleEtag) {
                await this.applyRemote(b.googleCalendarId, remote); b = this.store.booking(b.id)
                if (b.version !== job.payload.version || !active(b)) { this.store.finishJob(job.id); return }
              }
            }
            assert(Date.parse(b.startAt) > this.now(), 'APPOINTMENT_IN_PAST', 'La cita ya comenzó; requiere revisión administrativa.', 409)
            assert(!b.reviewRequired, 'CALENDAR_REVIEW_REQUIRED', 'El cambio externo requiere revisión administrativa.', 409)
            await this.checkSlot(barber, Date.parse(b.startAt), Date.parse(b.endAt), b.id)
          } else if (job.kind === 'hold') await this.checkSlot(barber, Date.parse(b.startAt), Date.parse(b.endAt), b.id)
          if (b.googleEventId && b.googleCalendarId !== barber.calendarId) {
            const moved = await this.adapter.move(b, barber.calendarId)
            b.googleCalendarId = barber.calendarId; b.googleEventId = moved.id; b.googleEtag = moved.etag; this.store.saveBooking(b)
          }
          const confirmed = job.kind === 'confirm' || b.status === 'confirmed'
          let event = await this.adapter.upsert(b, barber.calendarId, (b.serviceName || c.services.find(s => s.id === b.serviceId)?.name || { es: 'Cita', en: 'Appointment' })[b.language], confirmed)
          b.googleCalendarId = barber.calendarId; b.googleEventId = event.id; b.googleEtag = event.etag
          if (!b.autoConfirmAt) {
            b.autoConfirmAt = iso(this.now() + TWO_HOURS); this.store.saveBooking(b)
            event = await this.adapter.upsert(b, barber.calendarId, b.serviceName[b.language], false); b.googleEtag = event.etag
          }
          b.syncStatus = 'synced'; b.syncError = null
          if (job.kind === 'confirm') {
            b.status = 'confirmed'; b.confirmationSource = job.payload.source; b.hadInvite = true; b.pendingManualConfirmation = false; b.version++
            this.store.cancelJobs(b.id, ['confirm', 'email']); this.store.saveBooking(b); this.queueEmail(b, 'confirmed'); this.scheduleReminder(b)
            this.store.audit('booking.confirmed', b.id, job.payload.source === 'automatic' ? 'Confirmación automática tras dos horas.' : 'Aprobación administrativa.', this.now())
          } else {
            this.store.saveBooking(b)
            if (job.kind === 'hold') {
              if (!b.pendingManualConfirmation) this.queueEmail(b, 'received')
              this.store.job(`confirm:${b.id}:${b.version}:automatic`, 'confirm', b.id, Date.parse(b.autoConfirmAt), { version: b.version, source: 'automatic' })
              if (b.pendingManualConfirmation) this.store.job(`confirm:${b.id}:${b.version}:manual`, 'confirm', b.id, this.now(), { version: b.version, source: 'manual' })
              this.store.audit('booking.hold.synced', b.id, 'Retención sincronizada; plazo de revisión fijado una sola vez.', this.now())
            } else {
              if (b.status === 'pending') this.store.job(`confirm:${b.id}:${b.version}:automatic`, 'confirm', b.id, Date.parse(b.autoConfirmAt), { version: b.version, source: 'automatic' })
              this.queueEmail(b, 'rescheduled'); this.scheduleReminder(b)
            }
          }
          this.store.saveEvent(barber.calendarId, event)
        }
      } else if (job.kind === 'email' || job.kind === 'reminder') {
        if (!b || (job.kind === 'reminder' && (b.status !== 'confirmed' || Date.parse(b.startAt) <= this.now() || job.due < this.now() - 15 * 60000)) || (job.payload.kind === 'received' && b.autoConfirmAt && this.now() >= Date.parse(b.autoConfirmAt)) || (['received', 'confirmed', 'rescheduled'].includes(job.payload.kind) && !active(b))) { this.store.finishJob(job.id); return }
        const message = this.emailMessage(b, job.payload.kind)
        await this.adapter.sendEmail({ to: b.customer.email, ...message, messageId: job.id })
        this.store.audit(this.config.mode === 'demo' ? 'email.demo.skipped' : 'email.sent', b.id, `Tipo: ${job.payload.kind}.`, this.now())
      } else if (job.kind === 'block') {
        const block = this.store.all('blocks').find(v => v.id === job.payload.id)
        if (block) {
          const calendar = this.store.get('catalog').barbers.find(v => v.id === block.barberId)?.calendarId
          const pseudo = { id: `block-${block.id}`, version: 1, startAt: block.startAt, endAt: block.endAt, customer: { name: 'BLOQUEO ADMINISTRATIVO', email: '', phone: '' }, googleEventId: block.eventId, googleEtag: block.etag, autoConfirmAt: null }
          const event = await this.adapter.upsert(pseudo, calendar, block.reason || 'Horario bloqueado', false)
          this.store.put('blocks', { ...block, calendarId: calendar, eventId: event.id, etag: event.etag, syncStatus: 'synced' })
        }
      } else if (job.kind === 'removeBlock') await this.adapter.remove({ googleCalendarId: job.payload.calendarId, googleEventId: job.payload.eventId })
      this.store.finishJob(job.id)
    } catch (error) {
      const syncError = safeError(error)
      const emailUnknown = ['email', 'reminder'].includes(job.kind) && !(error.status === 429 || error.status === 403 || error.code === 'EMAIL_NOT_CONFIGURED')
      const terminal = (job.attempts >= 9 && ['email', 'reminder'].includes(job.kind)) || (error.code === 'APPOINTMENT_IN_PAST')
      const delay = error.retryAfter || Math.min(3600000, 10000 * 2 ** Math.min(job.attempts, 8))
      this.store.db.prepare('UPDATE jobs SET state=?,due=?,error=? WHERE id=?').run(emailUnknown ? 'uncertain' : terminal ? 'failed' : 'pending', this.now() + delay, syncError, job.id)
      if (b && !['email', 'reminder'].includes(job.kind)) { b = this.store.booking(b.id); b.syncStatus = 'error'; b.syncError = syncError; this.store.saveBooking(b) }
      this.store.audit(emailUnknown ? 'email.delivery.uncertain' : 'job.error', b?.id || null, emailUnknown ? 'Entrega de correo desconocida; no se reenvía automáticamente para evitar duplicados.' : `${job.kind}: ${syncError}`, this.now())
    }
  }
  emailMessage(b, kind) {
    const en = b.language === 'en', c = this.store.get('catalog'), format = value => new Intl.DateTimeFormat(en ? 'en-GB' : 'es', { timeZone: TIME_ZONE, dateStyle: 'full', timeStyle: 'short' }).format(new Date(value))
    const titles = { received: en ? 'Booking request received' : 'Solicitud recibida', confirmed: en ? 'Appointment confirmed' : 'Cita confirmada', rejected: en ? 'Booking request declined' : 'Solicitud rechazada', cancelled: en ? 'Appointment cancelled' : 'Cita cancelada', rescheduled: en ? 'Appointment rescheduled' : 'Cita reprogramada', reminder: en ? 'Your appointment is tomorrow' : 'Tu cita es mañana' }
    const details = kind === 'received' ? (en ? `Your time is held. Your appointment will be automatically confirmed at ${format(b.autoConfirmAt)} if the administrator does not decline it.` : `Tu horario está retenido. La cita se confirmará automáticamente el ${format(b.autoConfirmAt)} si el administrador no la rechaza.`) : ''
    return { subject: `${titles[kind]} · ${c.settings.name}`, text: `${c.settings.name}\n\n${titles[kind]}\n${b.customer.name}\n${(b.serviceName || { es: 'Cita', en: 'Appointment' })[b.language]}\n${format(b.startAt)} (${TIME_ZONE})\n${details}\n\n${en ? 'For changes or cancellation, contact the administrator.' : 'Para cambios o cancelaciones, contacta al administrador.'}\n${c.settings.whatsapp ? `WhatsApp: +${c.settings.whatsapp.replace(/\D/g, '')}` : ''}\n${en ? 'Reference' : 'Referencia'}: ${b.id}` }
  }
  async findMoved(b) {
    for (const barber of this.store.get('catalog').barbers.filter(v => v.calendarId)) {
      const events = await this.adapter.findLinked(barber.calendarId, b.id)
      const event = events.find(e => e.status !== 'cancelled')
      if (event) return { calendarId: barber.calendarId, event }
    }
    return null
  }
  externalCancel(b) {
    if (!active(b)) return
    this.store.transaction(() => {
      b.status = 'cancelled'; b.version++; b.syncStatus = 'synced'; b.syncError = null
      this.store.cancelJobs(b.id); this.store.saveBooking(b); this.queueEmail(b, 'cancelled'); this.store.audit('calendar.booking.cancelled', b.id, 'Evento eliminado directamente desde Google Calendar.', this.now())
    })
  }
  async applyRemote(calendarId, event) {
    const id = event.extendedProperties?.private?.bookingId
    let b = id ? this.store.booking(id) : this.store.bookings().find(v => v.googleCalendarId === calendarId && v.googleEventId === event.id)
    if (!b) {
      const block = this.store.all('blocks').find(v => v.calendarId === calendarId && v.eventId === event.id)
      if (block && event.status === 'cancelled') { this.store.delete('blocks', block.id); this.store.audit('calendar.block.deleted', null, 'Bloqueo eliminado desde Calendar.', this.now()) }
      else if (block && event.etag !== block.etag) {
        const interval = eventInterval(event)
        if (interval) { this.store.put('blocks', { ...block, startAt: iso(interval.start), endAt: iso(interval.end), etag: event.etag }); this.store.audit('calendar.block.changed', null, 'Horario del bloqueo actualizado desde Calendar.', this.now()) }
      }
      return
    }
    if (!active(b)) return
    if (event.status === 'cancelled') {
      if (b.googleCalendarId !== calendarId || b.googleEventId !== event.id) return
      const moved = await this.findMoved(b)
      if (moved && (moved.calendarId !== calendarId || moved.event.id !== event.id)) return this.applyRemote(moved.calendarId, moved.event)
      this.externalCancel(b); return
    }
    if (event.etag === b.googleEtag && b.googleCalendarId === calendarId && b.googleEventId === event.id) return
    // A known echo was handled above. An unknown etag with an older app revision
    // can be a direct Calendar edit racing the local outbox; never ignore it forever.
    const remoteRevision = Number(event.extendedProperties?.private?.revision || 0)
    const concurrent = b.syncStatus !== 'synced' && remoteRevision < b.version
    if (concurrent) {
      const latest = await this.adapter.getEvent(calendarId, event.id)
      if (!latest || latest.status === 'cancelled') { this.externalCancel(b); return }
      if (latest.etag === b.googleEtag) return
      event = latest
    }
    const interval = eventInterval(event), destination = this.store.get('catalog').barbers.find(v => v.calendarId === calendarId)
    if (!interval || event.recurrence || !event.start?.dateTime || !destination || !destination.serviceIds.includes(b.serviceId)) {
      b.syncStatus = 'error'; b.syncError = 'Cambio de Calendar no compatible: revisa duración, calendario y evento recurrente.'; b.reviewRequired = true; this.store.saveBooking(b); return
    }
    const changed = b.startAt !== iso(interval.start) || b.endAt !== iso(interval.end) || b.barberId !== destination.id
    b.googleEtag = event.etag; b.googleCalendarId = calendarId; b.googleEventId = event.id
    if (!changed && !concurrent) { this.store.saveBooking(b); return }
    const conflict = this.localConflict(destination.id, interval.start, interval.end, b.id)
    const tooSoon = b.status === 'pending' && interval.start <= this.now() + TWO_HOURS
    this.store.transaction(() => {
      const concurrentDetail = concurrent ? `Cambios simultáneos: se conservó Calendar y se detuvo el cambio local ${b.startAt} — ${b.endAt}. Revisa y aprueba o reprograma desde el portal.` : null
      b = { ...b, startAt: iso(interval.start), endAt: iso(interval.end), barberId: destination.id, version: b.version + 1, syncStatus: conflict || tooSoon || concurrent ? 'error' : 'synced', syncError: conflict ? 'El cambio en Calendar se superpone con otra cita o bloqueo.' : tooSoon ? 'Pendiente movida a menos de dos horas; requiere revisión administrativa.' : concurrentDetail, reviewRequired: conflict || tooSoon || concurrent }
      this.store.cancelJobs(b.id); this.store.saveBooking(b)
      if (b.status === 'pending' && b.autoConfirmAt && !b.reviewRequired) this.store.job(`confirm:${b.id}:${b.version}:automatic`, 'confirm', b.id, Date.parse(b.autoConfirmAt), { version: b.version, source: 'automatic' })
      if (!b.reviewRequired) { this.queueEmail(b, 'rescheduled'); this.scheduleReminder(b) }
      this.store.audit('calendar.booking.changed', b.id, b.syncError || 'Fecha o barbero actualizado desde Calendar; plazo original conservado.', this.now())
    })
  }
  async syncCalendars() {
    return this.exclusive(async () => {
      if (this.config.mode === 'setup' || !this.adapter.connected()) return
      const calendars = this.store.get('catalog').barbers.filter(b => b.calendarId), changes = []
      try {
        for (const barber of calendars) {
          let token = this.store.get(`sync:${barber.calendarId}`), result, full = !token
          try { result = await this.adapter.listChanges(barber.calendarId, token) }
          catch (error) {
            if (error.status !== 410) throw error
            token = null; full = true; result = await this.adapter.listChanges(barber.calendarId)
          }
          // Commit token only with its event page set. A crash replays safely.
          this.store.transaction(() => {
            if (full) this.store.clearEvents(barber.calendarId)
            for (const event of result.events) this.store.saveEvent(barber.calendarId, event)
            this.store.set(`sync:${barber.calendarId}`, result.nextSyncToken)
          })
          changes.push(...result.events.map(event => ({ calendarId: barber.calendarId, event })))
          // A reset may no longer return a tombstone. Verify linked missing events explicitly.
          if (full) for (const b of this.store.bookings().filter(v => active(v) && v.googleCalendarId === barber.calendarId && v.googleEventId)) {
            if (!result.events.some(e => e.id === b.googleEventId)) {
              const event = await this.adapter.getEvent(barber.calendarId, b.googleEventId)
              changes.push({ calendarId: barber.calendarId, event: event || { id: b.googleEventId, status: 'cancelled' } })
            }
          }
        }
        for (const change of changes.filter(v => v.event.status !== 'cancelled')) await this.applyRemote(change.calendarId, change.event)
        for (const change of changes.filter(v => v.event.status === 'cancelled')) await this.applyRemote(change.calendarId, change.event)
        this.store.remove('sync.error')
      } catch (error) {
        this.store.set('sync.error', safeError(error)); this.store.audit('calendar.sync.error', null, safeError(error), this.now())
      }
    })
  }
  async updateCatalog(input) {
    return this.exclusive(async () => {
      const value = catalogInput(input), previous = this.store.get('catalog')
      assert(input.expectedRevision === catalogRevision(previous), 'CATALOG_CHANGED', 'La configuración cambió desde que comenzaste a editar. Actualiza los datos y revisa tus cambios antes de guardar.', 409)
      for (const b of this.store.bookings().filter(v => active(v))) {
        assert(value.services.some(s => s.id === b.serviceId) && value.barbers.some(v => v.id === b.barberId), 'CATALOG_IN_USE', 'No elimines servicios o barberos con citas activas; puedes desactivarlos.', 409)
        assert(value.barbers.find(v => v.id === b.barberId).calendarId === previous.barbers.find(v => v.id === b.barberId)?.calendarId, 'CALENDAR_IN_USE', 'Reprograma o cancela las citas antes de cambiar el calendario del barbero.', 409)
      }
      for (const block of this.store.all('blocks')) {
        const barber = value.barbers.find(v => v.id === block.barberId)
        assert(barber, 'BARBER_BLOCKED', 'Retira los bloqueos del barbero antes de eliminarlo; puedes desactivarlo.', 409)
        assert(barber.calendarId === previous.barbers.find(v => v.id === block.barberId)?.calendarId, 'CALENDAR_BLOCKED', 'Retira los bloqueos del barbero antes de cambiar su calendario.', 409)
      }
      if (value.settings.businessDataConfirmed && this.config.mode === 'live' && this.adapter.connected()) for (const barber of value.barbers.filter(v => v.active && v.calendarId)) await this.adapter.calendarExists(barber.calendarId)
      this.store.set('catalog', value); this.store.audit('catalog.updated', null, 'Configuración comercial actualizada.', this.now())
      return this.catalog()
    })
  }
  async createBlock(input) {
    return this.exclusive(async () => {
      assert(this.config.mode !== 'setup', 'SETUP_MODE', 'Activa el modo live después de configurar la integración.', 503)
      assert(input && this.store.get('catalog').barbers.some(b => b.id === input.barberId && b.calendarId), 'INVALID_BARBER', 'Selecciona un barbero con calendario.')
      const start = instant(input.startAt), end = instant(input.endAt)
      assert(end > start && end - start <= 31 * DAY && end > this.now(), 'INVALID_DATE', 'Intervalo de bloqueo no válido.')
      assert(!this.localConflict(input.barberId, start, end), 'SLOT_UNAVAILABLE', 'Hay una reserva o bloqueo en este intervalo.', 409)
      const block = { id: randomUUID(), barberId: input.barberId, startAt: iso(start), endAt: iso(end), reason: text(input.reason || '', 300, true), syncStatus: 'pending' }
      this.store.transaction(() => { this.store.put('blocks', block); this.store.job(`block:${block.id}`, 'block', null, this.now(), { id: block.id }); this.store.audit('block.created', null, 'Intervalo administrativo bloqueado.', this.now()) })
      for (const job of this.store.dueJobs(this.now()).filter(j => j.id === `block:${block.id}`)) await this.execute(job)
      return { id: block.id, barberId: block.barberId, startAt: block.startAt, endAt: block.endAt, reason: block.reason }
    })
  }
  async deleteBlock(id) {
    return this.exclusive(async () => {
      assert(this.config.mode !== 'setup', 'SETUP_MODE', 'Activa el modo live después de configurar la integración.', 503)
      const block = this.store.all('blocks').find(v => v.id === id); assert(block, 'NOT_FOUND', 'Bloqueo no encontrado.', 404)
      this.store.transaction(() => { this.store.delete('blocks', id); this.store.db.prepare("UPDATE jobs SET state='cancelled' WHERE id=? AND state='pending'").run(`block:${id}`); if (block.eventId) this.store.job(`removeBlock:${id}`, 'removeBlock', null, this.now(), block); this.store.audit('block.deleted', null, 'Bloqueo retirado.', this.now()) })
      for (const job of this.store.dueJobs(this.now()).filter(j => j.id === `removeBlock:${id}`)) await this.execute(job)
    })
  }
  photoMetadata(input, partial = false) {
    assert(input && typeof input === 'object')
    const result = {}
    if (!partial || input.section !== undefined) { assert(['hero', 'gallery', 'barbers'].includes(input.section)); result.section = input.section }
    if (!partial || input.alt !== undefined) result.alt = localized(input.alt, 300, true)
    if (!partial || input.sortOrder !== undefined) { assert(Number.isInteger(input.sortOrder) && Math.abs(input.sortOrder) <= 100000); result.sortOrder = input.sortOrder }
    return result
  }
  writePhotoFile(dataUrl) {
    assert(typeof dataUrl === 'string' && dataUrl.length <= 7 * 1024 * 1024, 'PHOTO_TOO_LARGE', 'La fotografía no puede superar 5 MB.', 413)
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl)
    assert(match && match[2].length % 4 === 0, 'INVALID_IMAGE', 'Carga una imagen JPEG, PNG o WebP válida.')
    const data = Buffer.from(match[2], 'base64'), format = match[1]
    assert(data.length > 12 && data.length <= 5 * 1024 * 1024, 'PHOTO_TOO_LARGE', 'La fotografía debe pesar entre 13 bytes y 5 MB.', 413)
    const valid = format === 'png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.subarray(12, 16).toString() === 'IHDR' : format === 'jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255 && data[data.length - 2] === 255 && data[data.length - 1] === 217 : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' && data.readUInt32LE(4) + 8 === data.length
    assert(valid, 'INVALID_IMAGE', 'El contenido no coincide con un formato de imagen admitido.')
    const id = randomUUID(), filename = `${id}.${format === 'jpeg' ? 'jpg' : format}`, target = path.join(this.config.mediaDir, filename)
    try { writeFileSync(`${target}.tmp`, data, { mode: 0o600, flag: 'wx' }); renameSync(`${target}.tmp`, target) }
    catch (error) { try { unlinkSync(`${target}.tmp`) } catch {} throw error }
    return { target, url: `/media/${filename}` }
  }
  uploadPhoto(input) {
    const metadata = this.photoMetadata(input), file = this.writePhotoFile(input.dataUrl)
    const photo = { id: randomUUID(), ...metadata, url: file.url }
    try { this.store.transaction(() => { this.store.put('photos', photo); this.store.audit('photo.created', null, `Sección: ${photo.section}.`, this.now()) }) }
    catch (error) { try { unlinkSync(file.target) } catch {} throw error }
    return photo
  }
  updatePhoto(id, input) {
    const photo = this.store.all('photos').find(v => v.id === id); assert(photo, 'NOT_FOUND', 'Fotografía no encontrada.', 404)
    const metadata = this.photoMetadata(input, true)
    const file = input.dataUrl === undefined ? null : this.writePhotoFile(input.dataUrl)
    const next = { ...photo, ...metadata, ...(file ? { url: file.url } : {}) }
    try { this.store.transaction(() => { this.store.put('photos', next); this.store.audit('photo.updated', null, `Sección: ${next.section}.`, this.now()) }) }
    catch (error) { if (file) { try { unlinkSync(file.target) } catch {} } throw error }
    // The new reference is committed first. An old unreferenced file is never
    // served by /media, even if filesystem cleanup cannot complete immediately.
    if (file && /^\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(photo.url)) { try { unlinkSync(path.join(this.config.mediaDir, path.basename(photo.url))) } catch {} }
    return next
  }
  deletePhoto(id) {
    const photo = this.store.all('photos').find(v => v.id === id); assert(photo, 'NOT_FOUND', 'Fotografía no encontrada.', 404)
    this.store.delete('photos', id)
    if (/^\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(photo.url)) {
      try { unlinkSync(path.join(this.config.mediaDir, path.basename(photo.url))) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    this.store.audit('photo.deleted', null, 'Fotografía retirada.', this.now())
  }
}
