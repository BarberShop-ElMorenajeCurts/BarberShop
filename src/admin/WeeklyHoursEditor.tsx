import { useState } from 'react'
import type { AdminBarber, WorkingHours } from '../lib/contracts'

const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const week = [1, 2, 3, 4, 5, 6, 0]

export function WeeklyHoursEditor({ barbers, disabled, onChange }: {
  barbers: AdminBarber[]
  disabled: boolean
  onChange: (index: number, hours: WorkingHours[]) => void
}) {
  const [selected, setSelected] = useState(barbers[0]?.id ?? '')
  const [source, setSource] = useState('')
  const index = Math.max(0, barbers.findIndex(barber => barber.id === selected))
  const barber = barbers[index]
  if (!barber) return <div className="adm-empty"><p>Agrega un barbero antes de configurar sus horarios.</p></div>
  const replace = (hours: WorkingHours[]) => onChange(index, hours)
  const dayHours = (day: number) => barber.weeklyHours.filter(hours => hours.weekday === day).sort((a, b) => a.start.localeCompare(b.start))
  const setDay = (day: number, hours: WorkingHours[]) => replace([...barber.weeklyHours.filter(hours => hours.weekday !== day), ...hours])
  const copy = () => {
    const other = barbers.find(item => item.id === source)
    if (!other || other.id === barber.id) return
    if (barber.weeklyHours.length && !window.confirm(`¿Reemplazar el horario de ${barber.name} por el de ${other.name}?`)) return
    replace(structuredClone(other.weeklyHours))
  }
  return <>
    <div className="adm-hours-toolbar">
      <label className="adm-field"><span>Horario de</span><select value={barber.id} disabled={disabled} onChange={event => { setSelected(event.target.value); setSource('') }}>{barbers.map(item => <option key={item.id} value={item.id}>{item.name || 'Barbero sin nombre'}{item.active ? '' : ' · Inactivo'}</option>)}</select></label>
      <label className="adm-field"><span>Copiar horario de otro barbero</span><select value={source} disabled={disabled} onChange={event => setSource(event.target.value)}><option value="">Selecciona un barbero</option>{barbers.filter(item => item.id !== barber.id).map(item => <option key={item.id} value={item.id}>{item.name || 'Barbero sin nombre'}</option>)}</select></label>
      <button type="button" className="adm-button adm-button--outline" disabled={disabled || !source} onClick={copy}>Copiar horario</button>
    </div>
    <p className="adm-muted">Hora de Curaçao. Desmarca un día para cerrarlo; agrega intervalos separados para incluir una pausa. Los cambios se aplican al guardar.</p>
    {!barber.active && <p className="adm-inline-warning">Este barbero está inactivo y no aparece para nuevas reservas. Puedes preparar su horario antes de activarlo.</p>}
    <div className="adm-week">{week.map(day => {
      const intervals = dayHours(day)
      return <div className="adm-day" key={`${barber.id}-${day}`}>
        <label className="adm-check adm-day-toggle"><input type="checkbox" checked={intervals.length > 0} disabled={disabled} onChange={event => setDay(day, event.target.checked ? [{ weekday: day, start: '09:00', end: '21:00' }] : [])} /><span>{days[day]}<small>{intervals.length ? `${intervals.length} intervalo${intervals.length === 1 ? '' : 's'}` : 'Cerrado'}</small></span></label>
        <div className="adm-day-intervals">{intervals.map((hours, position) => <div className="adm-day-interval" key={position}>
          <label className="adm-field"><span>Desde</span><input type="time" required aria-label={`${days[day]} · Inicio ${position + 1}`} value={hours.start} disabled={disabled} onChange={event => setDay(day, intervals.map((item, i) => i === position ? { ...item, start: event.target.value } : item))} /></label>
          <span aria-hidden="true">—</span>
          <label className="adm-field"><span>Hasta</span><input type="time" required aria-label={`${days[day]} · Fin ${position + 1}`} value={hours.end} disabled={disabled} onChange={event => setDay(day, intervals.map((item, i) => i === position ? { ...item, end: event.target.value } : item))} /></label>
          <button type="button" className="adm-icon-button" disabled={disabled} aria-label={`Quitar intervalo ${position + 1} del ${days[day]}`} onClick={() => setDay(day, intervals.filter((_, i) => i !== position))}>×</button>
        </div>)}{intervals.length > 0 && intervals.length < 6 && <button type="button" className="adm-text-link" disabled={disabled || intervals[intervals.length - 1].end >= '23:59'} onClick={() => setDay(day, [...intervals, { weekday: day, start: intervals[intervals.length - 1].end, end: '23:59' }])}>+ Agregar intervalo</button>}</div>
      </div>
    })}</div>
    <p className="adm-inline-warning">Cambiar el horario semanal no cancela las citas existentes. Para vacaciones, almuerzos o ausencias de una fecha específica, usa «Bloquear horario» en la agenda.</p>
  </>
}
