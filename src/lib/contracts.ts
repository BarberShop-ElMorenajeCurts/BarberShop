export type Language = 'es' | 'en'
export type LocalizedText = Record<Language, string>
export type AppMode = 'setup' | 'demo' | 'live'
export type BookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'
export type SyncStatus = 'pending' | 'synced' | 'error'
export type PhotoSection = 'hero' | 'gallery' | 'barbers'

export interface Service {
  id: string
  name: LocalizedText
  description: LocalizedText
  durationMinutes: number | null
  price: number | null
  currency: string | null
  accent: 'yellow' | 'red' | 'blue'
  active: boolean
}

export interface Barber {
  id: string
  name: string
  specialty: LocalizedText
  serviceIds: string[]
  active: boolean
  weeklyHours?: WorkingHours[]
}

export interface WorkingHours {
  weekday: number
  start: string
  end: string
}

export interface AdminBarber extends Barber {
  calendarId: string
  weeklyHours: WorkingHours[]
}

export interface BusinessSettings {
  name: string
  timeZone: string
  /** International phone number, optional leading +. The UI builds wa.me URLs. */
  whatsapp: string
  instagram: string
  tiktok: string
  facebook?: string
  address: LocalizedText
  mapsUrl: string
  businessDataConfirmed: boolean
}

export interface Photo {
  id: string
  section: PhotoSection
  url: string
  alt: LocalizedText
  sortOrder: number
}

export interface Catalog {
  revision: string
  mode: AppMode
  bookingEnabled: boolean
  settings: BusinessSettings
  services: Service[]
  barbers: Barber[]
  photos: Photo[]
}

export interface AvailabilitySlot {
  startAt: string
  endAt: string
}

export interface Availability {
  date: string
  timeZone: string
  slots: AvailabilitySlot[]
}

export interface Customer {
  name: string
  email: string
  phone: string
}

export interface CreateBookingInput {
  serviceId: string
  barberId: string
  startAt: string
  customer: Customer
  language: Language
  idempotencyKey: string
}

export interface BookingReceipt {
  id: string
  status: BookingStatus
  syncStatus: SyncStatus
  startAt: string
  endAt: string
  autoConfirmAt: string | null
  mode: AppMode
}

export interface Booking extends BookingReceipt {
  serviceId: string
  barberId: string
  customer: Customer
  language: Language
  createdAt: string
  confirmationSource: 'manual' | 'automatic' | null
  version: number
  syncError: string | null
}

export interface Block {
  id: string
  barberId: string
  startAt: string
  endAt: string
  reason: string
}

export interface Session {
  authenticated: boolean
  mode: AppMode
  authConfigured: boolean
  csrfToken: string | null
  user: { name: string; email: string; picture?: string } | null
}

export interface IntegrationStatus {
  googleConnected: boolean
  emailConfigured: boolean
  businessReady: boolean
  warnings: string[]
}

export interface AuditEntry {
  id: string
  at: string
  action: string
  bookingId: string | null
  detail: string
}

export interface AdminOverview {
  catalog: Catalog & { barbers: AdminBarber[] }
  bookings: Booking[]
  blocks: Block[]
  integration: IntegrationStatus
  audit: AuditEntry[]
}

export interface CatalogUpdate {
  expectedRevision: string
  settings: BusinessSettings
  services: Service[]
  barbers: AdminBarber[]
}

export interface BookingAction {
  action: 'approve' | 'reject' | 'cancel' | 'reschedule'
  expectedVersion: number
  startAt?: string
  barberId?: string
  reason?: string
}

export interface ManualBookingInput extends CreateBookingInput {
  status: 'pending' | 'confirmed'
}

export interface PhotoUpload {
  dataUrl: string
  section: PhotoSection
  alt: LocalizedText
  sortOrder: number
}

export interface ApiProblem {
  error: { code: string; message: string }
}
