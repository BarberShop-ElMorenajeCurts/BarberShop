import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { api, ApiError } from "../lib/api"
import type {
  Availability,
  BookingReceipt,
  Catalog,
  Customer,
  Language,
} from "../lib/contracts"
import {
  formatDate,
  localDate,
  serviceDuration,
  servicePrice,
  whatsappUrl,
  type Translate,
} from "./content"
import { Icon } from "./ui"

export function BookingPanel({
  catalog,
  language,
  selectedService,
  onSelectService,
  compact = false,
}: {
  catalog: Catalog
  language: Language
  selectedService: string
  onSelectService: (id: string) => void
  compact?: boolean
}) {
  const t: Translate = (es, en) => (language === "es" ? es : en)
  const id = useId()
  const [step, setStep] = useState(1)
  const [barberId, setBarberId] = useState("")
  const [date, setDate] = useState(() => localDate(catalog.settings.timeZone))
  const [startAt, setStartAt] = useState("")
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [loading, setLoading] = useState(false)
  const [availabilityFailed, setAvailabilityFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [customer, setCustomer] = useState<Customer>({
    name: "",
    email: "",
    phone: "",
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null)
  const requestRef = useRef<{
    signature: string
    key: string
  } | null>(null)
  const submissionInFlight = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const services = catalog.services.filter((service) => service.active)
  const service = services.find((item) => item.id === selectedService)
  const barbers = catalog.barbers.filter(
    (barber) => barber.active && barber.serviceIds.includes(selectedService),
  )
  const barber = barbers.find((item) => item.id === barberId)
  const timeZone = catalog.settings.timeZone
  const whatsapp = whatsappUrl(catalog.settings.whatsapp)

  useEffect(() => {
    setBarberId("")
    setStartAt("")
    setReceipt(null)
    setStep(1)
    setError("")
  }, [selectedService])
  useEffect(() => {
    if (step !== 3 || !service || !barber || !date || !catalog.bookingEnabled) {
      setLoading(false)
      return
    }
    let active = true
    setAvailability(null)
    setStartAt("")
    setLoading(true)
    setAvailabilityFailed(false)
    api
      .availability(service.id, barber.id, date)
      .then((result) => {
        if (active) setAvailability(result)
      })
      .catch(() => {
        if (active) setAvailabilityFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [step, selectedService, barberId, date, catalog.bookingEnabled, refresh])
  useEffect(() => {
    if (step > 1 || receipt) headingRef.current?.focus()
  }, [step, receipt])

  const errorText = (code: string) => {
    if (
      [
        "SLOT_UNAVAILABLE",
        "CONFLICT",
        "SLOT_TAKEN",
        "BOOKING_CONFLICT",
      ].includes(code)
    )
      return t(
        "Ese horario ya no está disponible. Vuelve a Fecha y elige otro.",
        "This time is no longer available. Return to Date and choose another.",
      )
    if (
      [
        "TOO_SOON",
        "LEAD_TIME",
        "INVALID_START",
        "INSUFFICIENT_NOTICE",
        "BOOKING_TOO_SOON",
        "APPOINTMENT_IN_PAST",
      ].includes(code)
    )
      return t(
        "Las citas online requieren más de dos horas de anticipación. Elige una hora posterior o contacta al administrador.",
        "Online bookings require more than two hours notice. Choose a later time or contact the administrator.",
      )
    if (["BOOKING_DISABLED", "NOT_CONFIGURED", "SETUP_REQUIRED"].includes(code))
      return t(
        "Las reservas online todavía no están habilitadas.",
        "Online bookings are not enabled yet.",
      )
    if (["INVALID_INPUT", "VALIDATION_ERROR", "INVALID_CUSTOMER"].includes(code))
      return t(
        "Revisa los datos y vuelve a intentarlo.",
        "Please check your details and try again.",
      )
    return t(
      "No pudimos completar el envío. Tu solicitud aún no está confirmada. Reintenta con los mismos datos para evitar duplicados.",
      "We could not complete submission. Your request is not confirmed. Retry with the same details to avoid duplicates.",
    )
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      submissionInFlight.current ||
      !catalog.bookingEnabled ||
      !service ||
      !barber ||
      !startAt
    )
      return
    if (
      !customer.name.trim() ||
      !customer.email.trim() ||
      !customer.phone.trim()
    ) {
      setError("VALIDATION_ERROR")
      return
    }
    const payload = {
      serviceId: service.id,
      barberId: barber.id,
      startAt,
      customer: {
        name: customer.name.trim(),
        email: customer.email.trim(),
        phone: customer.phone.trim(),
      },
      language,
    }
    const signature = JSON.stringify(payload)
    if (requestRef.current?.signature !== signature)
      requestRef.current = { signature, key: crypto.randomUUID() }
    submissionInFlight.current = true
    setSending(true)
    setError("")
    try {
      setReceipt(
        await api.createBooking({
          ...payload,
          idempotencyKey: requestRef.current.key,
        }),
      )
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.code : "NETWORK_ERROR")
    } finally {
      submissionInFlight.current = false
      setSending(false)
    }
  }
  const reset = () => {
    setReceipt(null)
    setStep(1)
    setBarberId("")
    setStartAt("")
    setCustomer({ name: "", email: "", phone: "" })
    setError("")
    requestRef.current = null
  }
  const nextDisabled =
    !catalog.bookingEnabled ||
    (step === 1 && !service) ||
    (step === 2 && !barber) ||
    (step === 3 && (!startAt || loading || availabilityFailed))

  if (receipt)
    return (
      <section
        className={`booking-panel booking-panel--success ${
          compact ? "booking-panel--compact" : ""
        }`}
        aria-live="polite"
      >
        <div className="success-icon">
          <Icon
            name={receipt.syncStatus === "synced" ? "check" : "clock"}
            size={28}
          />
        </div>
        <span className="kicker">
          {receipt.mode === "demo"
            ? t("Demostración · sin cita real", "Demo · no real appointment")
            : t("Solicitud registrada", "Request recorded")}
        </span>
        <h3 ref={headingRef} tabIndex={-1}>
          {receipt.status === "confirmed" && receipt.syncStatus === "synced"
            ? t("Tu cita está confirmada.", "Your appointment is confirmed.")
            : receipt.status === "rejected"
              ? t("Solicitud rechazada.", "Request declined.")
              : receipt.status === "cancelled"
                ? t("Solicitud cancelada.", "Request cancelled.")
                : t("Pendiente de confirmación.", "Awaiting confirmation.")}
        </h3>
        <p>
          {service?.name[language]} ·{" "}
          {formatDate(receipt.startAt, language, timeZone)}
          <br />
          {timeZone}
        </p>
        {receipt.status === "pending" &&
          receipt.autoConfirmAt &&
          receipt.syncStatus === "synced" && (
            <p>
              {t(
                "Se confirmará automáticamente el",
                "It will be automatically confirmed on",
              )}{" "}
              <strong>
                {formatDate(receipt.autoConfirmAt, language, timeZone)}
              </strong>{" "}
              ({timeZone}){" "}
              {t(
                "si el administrador no la rechaza antes y no hay conflictos de agenda.",
                "unless the administrator declines it first, provided there are no scheduling conflicts.",
              )}
            </p>
          )}
        {receipt.syncStatus !== "synced" && (
          <p className="booking-notice">
            {t(
              "La sincronización sigue pendiente o necesita revisión. Tu cita aún no está confirmada. Contacta al administrador.",
              "Synchronization is pending or needs review. Your appointment is not confirmed yet. Please contact the administrator.",
            )}
          </p>
        )}
        <p>
          {t(
            "Para cancelar o reprogramar, contacta al administrador.",
            "To cancel or reschedule, contact the administrator.",
          )}
        </p>
        {whatsapp && (
          <a
            className="button button--outline"
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp <Icon name="whatsapp" />
          </a>
        )}
        <button className="back-link" onClick={reset}>
          {t("Solicitar otra cita", "Request another appointment")}
        </button>
      </section>
    )

  return (
    <form
      className={`booking-panel ${compact ? "booking-panel--compact" : ""}`}
      onSubmit={submit}
      aria-label={t("Solicitud de reserva", "Appointment request")}
      aria-busy={sending}
    >
      <div className="booking-panel__top">
        <div>
          <span className="kicker">{t("Reserva online", "Book online")}</span>
          <h3 ref={headingRef} tabIndex={-1}>
            {t("Tu próximo corte.", "Your next haircut.")}
          </h3>
        </div>
        <div className="step-count">0{step} / 04</div>
      </div>
      {catalog.mode !== "live" && (
        <p className="booking-notice">
          {catalog.mode === "demo"
            ? t(
                "Demostración: las solicitudes no crean citas, eventos ni correos reales.",
                "Demo: requests do not create real appointments, events or emails.",
              )
            : t(
                "En preparación: la agenda online se habilitará al completar su configuración. Puedes contactar por WhatsApp.",
                "In preparation: online booking will be enabled once setup is complete. You can contact us on WhatsApp.",
              )}
        </p>
      )}
      {!catalog.bookingEnabled && catalog.mode === "live" && (
        <p className="booking-notice">
          {t(
            "Las reservas online no están disponibles por ahora.",
            "Online bookings are currently unavailable.",
          )}
        </p>
      )}
      <div
        className="booking-steps"
        aria-label={t("Progreso de solicitud", "Request progress")}
      >
        {[
          t("Servicio", "Service"),
          t("Barbero", "Barber"),
          t("Fecha", "Date"),
          t("Datos", "Details"),
        ].map((label, index) => (
          <div
            className={step >= index + 1 ? "active" : ""}
            aria-current={step === index + 1 ? "step" : undefined}
            key={index}
          >
            <span>
              {step > index + 1 ? <Icon name="check" size={12} /> : index + 1}
            </span>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <div className="booking-panel__body">
        {step === 1 && (
          <div
            className="booking-options"
            role="group"
            aria-label={t("Servicio", "Service")}
          >
            {services.map((item) => (
              <button
                type="button"
                key={item.id}
                className={selectedService === item.id ? "selected" : ""}
                aria-pressed={selectedService === item.id}
                onClick={() => onSelectService(item.id)}
              >
                <span>{item.name[language]}</span>
                <small>
                  {serviceDuration(item, t)} · {servicePrice(item, language, t)}
                </small>
                <i>
                  <Icon name="check" size={13} />
                </i>
              </button>
            ))}
            {services.length === 0 && (
              <p className="booking-notice">
                {t(
                  "El catálogo se está preparando.",
                  "The catalog is being prepared.",
                )}
              </p>
            )}
          </div>
        )}
        {step === 2 && (
          <div
            className="barber-options"
            role="group"
            aria-label={t("Barbero", "Barber")}
          >
            {barbers.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={barberId === item.id ? "selected" : ""}
                aria-pressed={barberId === item.id}
                onClick={() => {
                  setBarberId(item.id)
                  setStartAt("")
                }}
              >
                <span
                  className={`barber-avatar barber-avatar--${(index % 3) + 1}`}
                  aria-hidden="true"
                >
                  {item.name.charAt(0)}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.specialty[language]}</small>
                </span>
                <i>
                  <Icon name="check" size={13} />
                </i>
              </button>
            ))}
            {barbers.length === 0 && (
              <p className="booking-notice">
                {t(
                  "No hay barberos disponibles para este servicio.",
                  "No barbers are available for this service.",
                )}
              </p>
            )}
          </div>
        )}
        {step === 3 && (
          <>
            <label className="booking-field" htmlFor={`${id}-date`}>
              {t("Fecha", "Date")}
              <input
                id={`${id}-date`}
                type="date"
                value={date}
                min={localDate(timeZone)}
                onChange={(event) => {
                  setDate(event.target.value)
                  setStartAt("")
                  setAvailability(null)
                }}
                required
              />
            </label>
            <div role="status">
              {loading && (
                <p className="booking-notice">
                  {t("Consultando disponibilidad…", "Checking availability…")}
                </p>
              )}
              {!loading &&
                !availabilityFailed &&
                availability &&
                availability.slots.length === 0 && (
                  <p className="booking-notice">
                    {t(
                      "No hay horarios disponibles en esta fecha. Prueba con otra.",
                      "No times are available on this date. Please try another.",
                    )}
                  </p>
                )}
            </div>
            {availabilityFailed && (
              <div className="booking-error" role="alert">
                <p>
                  {t(
                    "No pudimos consultar la agenda.",
                    "We could not check the schedule.",
                  )}
                </p>
                <button
                  type="button"
                  className="back-link"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  {t("Reintentar", "Retry")}
                </button>
              </div>
            )}
            <div
              className="time-options"
              role="group"
              aria-label={t("Horarios disponibles", "Available times")}
            >
              {availability?.slots.map((slot) => (
                <button
                  type="button"
                  key={slot.startAt}
                  aria-pressed={startAt === slot.startAt}
                  className={startAt === slot.startAt ? "selected" : ""}
                  onClick={() => setStartAt(slot.startAt)}
                >
                  {new Intl.DateTimeFormat(language, {
                    timeZone: availability.timeZone,
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(slot.startAt))}
                </button>
              ))}
            </div>
            <p className="timezone">
              <Icon name="clock" size={14} />
              {timeZone}
            </p>
            <p className="booking-notice">
              {t(
                "Solo citas con más de 2 horas de anticipación. Para una cita más próxima, contacta al administrador.",
                "Appointments require more than 2 hours notice. For an earlier appointment, contact the administrator.",
              )}
            </p>
          </>
        )}
        {step === 4 && (
          <>
            <div className="booking-summary">
              <strong>{service?.name[language]}</strong>
              <span>
                {barber?.name} ·{" "}
                {startAt && formatDate(startAt, language, timeZone)}
              </span>
              <span>
                {service && servicePrice(service, language, t)} ·{" "}
                {service && serviceDuration(service, t)} · {timeZone}
              </span>
            </div>
            <label className="booking-field" htmlFor={`${id}-name`}>
              {t("Nombre completo", "Full name")}
              <input
                id={`${id}-name`}
                autoComplete="name"
                maxLength={120}
                value={customer.name}
                onChange={(event) =>
                  setCustomer((value) => ({
                    ...value,
                    name: event.target.value,
                  }))
                }
                disabled={sending}
                required
              />
            </label>
            <label className="booking-field" htmlFor={`${id}-email`}>
              {t("Correo electrónico", "Email address")}
              <input
                id={`${id}-email`}
                type="email"
                autoComplete="email"
                maxLength={254}
                value={customer.email}
                onChange={(event) =>
                  setCustomer((value) => ({
                    ...value,
                    email: event.target.value,
                  }))
                }
                disabled={sending}
                required
              />
            </label>
            <label className="booking-field" htmlFor={`${id}-phone`}>
              {t("Teléfono con código de país", "Phone with country code")}
              <input
                id={`${id}-phone`}
                type="tel"
                autoComplete="tel"
                maxLength={40}
                minLength={6}
                value={customer.phone}
                onChange={(event) =>
                  setCustomer((value) => ({
                    ...value,
                    phone: event.target.value,
                  }))
                }
                disabled={sending}
                required
              />
            </label>
            <p className="booking-notice">
              {t(
                "Usaremos estos datos para gestionar tu cita y enviarte sus avisos. La solicitud queda pendiente durante 2 horas; se confirma automáticamente si no es rechazada, sujeto a disponibilidad y sincronización.",
                "We use these details to manage your appointment and send its notices. Requests remain pending for 2 hours, then confirm automatically unless declined, subject to availability and synchronization.",
              )}
            </p>
            <p className="booking-notice">
              {t('Consulta nuestra ', 'Read our ')}
              <a className="underline underline-offset-2" href={t('/privacidad', '/privacy')} target="_blank" rel="noopener noreferrer">{t('Política de Privacidad', 'Privacy Policy')}</a>
              {t(' y las ', ' and ')}
              <a className="underline underline-offset-2" href={t('/condiciones', '/terms')} target="_blank" rel="noopener noreferrer">{t('Condiciones del Servicio', 'Terms of Service')}</a>.
            </p>
          </>
        )}
      </div>
      {error && (
        <p className="booking-error" role="alert">
          {errorText(error)}
        </p>
      )}
      <div className="booking-panel__footer">
        {step > 1 ? (
          <button
            className="back-link"
            type="button"
            disabled={sending}
            onClick={() => {
              setStep((value) => value - 1)
              setError("")
            }}
          >
            {t("Volver", "Back")}
          </button>
        ) : (
          <span />
        )}
        {step === 4 ? (
          <button
            className="button button--primary"
            type="submit"
            disabled={sending || !catalog.bookingEnabled}
          >
            {sending
              ? t("Enviando…", "Submitting…")
              : t("Solicitar reserva", "Request appointment")}
            <Icon name="arrow" />
          </button>
        ) : (
          <button
            className="button button--primary"
            type="button"
            disabled={nextDisabled}
            onClick={() => setStep((value) => value + 1)}
          >
            {t("Continuar", "Continue")}
            <Icon name="arrow" />
          </button>
        )}
      </div>
    </form>
  )
}
