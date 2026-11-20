import type {
  AdminOverview, Availability, Block, Booking, BookingAction, BookingReceipt,
  Catalog, CatalogUpdate, CreateBookingInput, ManualBookingInput, Photo,
  PhotoUpload, Session,
} from './contracts'

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

let csrfToken: string | null = null

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body) headers.set('Content-Type', 'application/json')
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  let response: Response
  try {
    response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  } catch {
    throw new ApiError('NETWORK_ERROR', 'No se pudo conectar con el servidor.', 0)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(data?.error?.code ?? 'SERVER_ERROR', data?.error?.message ?? 'El servidor no está disponible.', response.status)
  }
  if (data === null && response.status !== 204) {
    throw new ApiError('SERVER_ERROR', 'Respuesta no válida del servidor.', response.status)
  }
  return data as T
}

const json = (value: unknown) => JSON.stringify(value)

export const api = {
  catalog: () => request<Catalog>('/api/catalog'),
  availability: (serviceId: string, barberId: string, date: string) =>
    request<Availability>(`/api/availability?${new URLSearchParams({ serviceId, barberId, date })}`),
  createBooking: (input: CreateBookingInput) =>
    request<BookingReceipt>('/api/bookings', { method: 'POST', body: json(input) }),
  session: async () => {
    const session = await request<Session>('/api/session')
    csrfToken = session.csrfToken
    return session
  },
  googleLoginUrl: '/api/auth/google',
  demoLogin: async () => {
    const session = await request<Session>('/api/auth/demo', { method: 'POST' })
    csrfToken = session.csrfToken
    return session
  },
  logout: async () => {
    await request<void>('/api/auth/logout', { method: 'POST' })
    csrfToken = null
  },
  overview: () => request<AdminOverview>('/api/admin/overview'),
  updateCatalog: (input: CatalogUpdate) =>
    request<Catalog>('/api/admin/catalog', { method: 'PUT', body: json(input) }),
  bookingAction: (id: string, action: BookingAction) =>
    request<Booking>(`/api/admin/bookings/${encodeURIComponent(id)}/action`, { method: 'POST', body: json(action) }),
  manualBooking: (input: ManualBookingInput) =>
    request<Booking>('/api/admin/bookings', { method: 'POST', body: json(input) }),
  createBlock: (input: Omit<Block, 'id'>) =>
    request<Block>('/api/admin/blocks', { method: 'POST', body: json(input) }),
  deleteBlock: (id: string) =>
    request<void>(`/api/admin/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadPhoto: (input: PhotoUpload) =>
    request<Photo>('/api/admin/photos', { method: 'POST', body: json(input) }),
  updatePhoto: (id: string, input: Partial<Omit<Photo, 'id' | 'url'>> & { dataUrl?: string }) =>
    request<Photo>(`/api/admin/photos/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) }),
  deletePhoto: (id: string) =>
    request<void>(`/api/admin/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
