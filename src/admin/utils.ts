export function formatDate(value: string, timeZone: string, short = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es', {
    timeZone,
    dateStyle: short ? 'short' : 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function localDateTime(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function localToISO(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Selecciona fecha y hora.')
  const target = Date.parse(`${value}:00Z`)
  let instant = target
  for (let index = 0; index < 3; index += 1) {
    const formatted = localDateTime(new Date(instant).toISOString(), timeZone)
    const localAsUTC = Date.parse(`${formatted}:00Z`)
    instant += target - localAsUTC
  }
  if (localDateTime(new Date(instant).toISOString(), timeZone) !== value) {
    throw new Error('La hora no existe en la zona horaria seleccionada.')
  }
  return new Date(instant).toISOString()
}

export function remaining(deadline: string | null, now: number) {
  if (!deadline) return 'Sincronizando bloqueo'
  const seconds = Math.ceil((Date.parse(deadline) - now) / 1000)
  if (seconds <= 0) return 'Procesando confirmación automática'
  const minutes = Math.ceil(seconds / 60)
  return `Confirma en ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A'
}

export function auditTitle(action: string) {
  const labels: Record<string, string> = {
    'booking.requested': 'Solicitud recibida',
    'booking.manual.created': 'Cita registrada por el administrador',
    'booking.hold.synced': 'Horario reservado para revisión',
    'booking.confirmed': 'Cita confirmada',
    'booking.rejected': 'Solicitud rechazada',
    'booking.cancelled': 'Cita cancelada',
    'booking.rescheduled': 'Cita reprogramada',
    'calendar.booking.changed': 'Cita actualizada desde Google Calendar',
    'calendar.booking.cancelled': 'Cita cancelada desde Google Calendar',
    'calendar.block.changed': 'Bloqueo actualizado desde Google Calendar',
    'calendar.block.deleted': 'Bloqueo retirado desde Google Calendar',
    'calendar.sync.error': 'Sincronización pendiente de revisión',
    'calendar.local.conflict': 'Cambio de agenda en conflicto',
    'google.connected': 'Cuenta Google conectada',
    'email.sent': 'Correo enviado',
    'email.demo.skipped': 'Correo de demostración, sin envío real',
    'email.delivery.uncertain': 'Entrega de correo por revisar',
    'block.created': 'Horario bloqueado',
    'block.deleted': 'Horario habilitado',
    'photo.created': 'Fotografía agregada',
    'photo.updated': 'Fotografía actualizada',
    'photo.deleted': 'Fotografía retirada',
    'catalog.updated': 'Información del negocio actualizada',
    'job.error': 'Operación pendiente de revisión',
    'worker.error': 'Procesamiento pendiente de revisión',
    'server.error': 'Operación no completada',
  }
  return labels[action] || 'Actividad del sistema'
}

export function auditDetail(detail: string) {
  const labels: Record<string, string> = {
    'Tipo: received.': 'Aviso de solicitud recibida.',
    'Tipo: confirmed.': 'Aviso de confirmación.',
    'Tipo: rejected.': 'Aviso de rechazo.',
    'Tipo: cancelled.': 'Aviso de cancelación.',
    'Tipo: rescheduled.': 'Aviso de reprogramación.',
    'Tipo: reminder.': 'Recordatorio previo a la cita.',
    'Sección: gallery.': 'Sección: Galería.',
    'Sección: hero.': 'Sección: Portada.',
    'Sección: barbers.': 'Sección: Equipo.',
  }
  return labels[detail] || detail
}
