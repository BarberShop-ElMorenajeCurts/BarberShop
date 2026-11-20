import type { Barber, Catalog, Language, Service, Photo } from "../lib/contracts"
import business from "../../config/business.public.json"
import photography from "../../config/photography.public.json"

export type Translate = (es: string, en: string) => string
export const ownedPhotos: Photo[] = photography.map(photo => ({ ...photo, section: photo.section as Photo["section"] }))

export const fallbackCatalog: Catalog = {
  revision: "offline",
  mode: "setup",
  bookingEnabled: false,
  settings: structuredClone(business.settings),
  services: business.services.map(service => ({ ...service, name: { ...service.name }, description: { ...service.description }, accent: service.accent as Service["accent"] })),
  barbers: business.barbers.map(barber => ({ ...barber, specialty: { ...barber.specialty }, serviceIds: [...barber.serviceIds], weeklyHours: business.weeklyHours.map(hours => ({ ...hours })) })),
  photos: structuredClone(ownedPhotos),
}

export function serviceDuration(service: Service, t: Translate) {
  return service.durationMinutes === null
    ? t("Duración por confirmar", "Duration to be confirmed")
    : `${service.durationMinutes} min`
}

export function servicePrice(
  service: Service,
  language: Language,
  t: Translate,
) {
  if (service.price === null || !service.currency)
    return t("Precio por confirmar", "Price to be confirmed")
  try {
    return new Intl.NumberFormat(language, {
      style: "currency",
      currencyDisplay: "code",
      currency: service.currency,
    }).format(service.price)
  } catch {
    return `${service.price} ${service.currency}`
  }
}

export function safeExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.href : ""
  } catch {
    return ""
  }
}

export function whatsappUrl(value: string) {
  const phone = value.trim()
  return /^\+?[0-9]{7,20}$/.test(phone)
    ? `https://wa.me/${phone.replace(/^\+/, "")}`
    : ""
}

export function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

export function formatDate(
  instant: string,
  language: Language,
  timeZone: string,
) {
  return new Intl.DateTimeFormat(language === "es" ? "es" : "en", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant))
}

export function openingHours(barbers: Barber[], language: Language) {
  const active = barbers.filter(barber => barber.active)
  if (!active.some(barber => barber.weeklyHours?.length)) return []
  const days = language === "es" ? ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const rows: { first: number; last: number; hours: string }[] = []
  for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
    const intervals = active.flatMap(barber => (barber.weeklyHours ?? []).filter(hours => hours.weekday === weekday)).map(hours => ({ start: hours.start, end: hours.end })).sort((a, b) => a.start.localeCompare(b.start))
    const merged: { start: string; end: string }[] = []
    for (const interval of intervals) {
      const previous = merged[merged.length - 1]
      if (previous && interval.start <= previous.end) { if (interval.end > previous.end) previous.end = interval.end }
      else merged.push({ ...interval })
    }
    const hours = merged.length ? merged.map(interval => interval.start + " — " + interval.end).join(" / ") : language === "es" ? "Cerrado" : "Closed"
    const previous = rows[rows.length - 1]
    if (previous && previous.hours === hours) previous.last = weekday
    else rows.push({ first: weekday, last: weekday, hours })
  }
  return rows.map(row => ({ label: row.first === row.last ? days[row.first] : days[row.first] + " — " + days[row.last], hours: row.hours }))
}
