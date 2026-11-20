import { useEffect, useRef, useState } from "react"

import { api } from "./lib/api"

import type { Catalog, Language, Photo } from "./lib/contracts"

import { BookingPanel } from "./public/BookingPanel"

import { Dialog } from "./public/Dialog"

import { Button, Icon, SectionTitle } from "./public/ui"

import {
  fallbackCatalog,
  openingHours,
  safeExternalUrl,
  serviceDuration,
  servicePrice,
  whatsappUrl,
  type Translate,
} from "./public/content"

function readLanguage(): Language {
  try {
    return localStorage.getItem("elmorenaje-language") === "en" ? "en" : "es"
  } catch {
    return "es"
  }
}

export default function App() {
  const [language, setLanguage] = useState<Language>(readLanguage)

  const [catalog, setCatalog] = useState<Catalog>(fallbackCatalog)

  const [catalogState, setCatalogState] =
    useState<"loading" | "ready" | "error">("loading")

  const [catalogRetry, setCatalogRetry] = useState(0)

  const [menuOpen, setMenuOpen] = useState(false)

  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  )

  const [bookingOpen, setBookingOpen] = useState(false)

  const [visibleGalleryCount, setVisibleGalleryCount] = useState(5)

  const [selectedService, setSelectedService] = useState("")

  const [lightbox, setLightbox] = useState<Pick<Photo, "url" | "alt"> | null>(
    null,
  )

  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const navRef = useRef<HTMLElement>(null)

  const t: Translate = (es, en) => (language === "es" ? es : en)

  useEffect(() => {
    let active = true

    setCatalogState("loading")

    api
      .catalog()
      .then((result) => {
        if (!active) return

        setCatalog({
          ...result,
          services:
            result.services.length === 0 && !result.bookingEnabled
              ? fallbackCatalog.services
              : result.services,
        })

        setSelectedService((current) =>
          result.services.some(
            (service) => service.active && service.id === current,
          )
            ? current
            : (result.services.find((service) => service.active)?.id ?? ""),
        )

        setCatalogState("ready")
      })
      .catch(() => {
        if (active) {
          setCatalog(fallbackCatalog)
          setSelectedService(fallbackCatalog.services[0].id)
          setCatalogState("error")
        }
      })

    return () => {
      active = false
    }
  }, [catalogRetry])

  useEffect(() => {
    document.documentElement.lang = language

    document.title =
      language === "es"
        ? "ElMorenaje Cuts · Barbería en Curaçao"
        : "ElMorenaje Cuts · Barbershop in Curaçao"

    try {
      localStorage.setItem("elmorenaje-language", language)
    } catch {
      /* Storage can be disabled. */
    }
  }, [language])

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)")

    const change = () => {
      setMobile(media.matches)
      if (!media.matches) setMenuOpen(false)
    }

    media.addEventListener("change", change)

    return () => media.removeEventListener("change", change)
  }, [])

  useEffect(() => {
    if (!menuOpen || !mobile) return

    navRef.current?.querySelector("a")?.focus()

    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }

    document.addEventListener("keydown", close)

    return () => document.removeEventListener("keydown", close)
  }, [menuOpen, mobile])

  const services = catalog.services.filter((service) => service.active)

  const photos = (section: Photo["section"]) =>
    catalog.photos
      .filter((photo) => photo.section === section)
      .sort((a, b) => a.sortOrder - b.sortOrder)

  const hero = photos("hero")[0]

  const barberPhoto = photos("barbers")[0]

  const gallery = photos("gallery")

  const whatsapp = whatsappUrl(catalog.settings.whatsapp)

  const instagram = safeExternalUrl(catalog.settings.instagram)

  const tiktok = safeExternalUrl(catalog.settings.tiktok)
  const facebook = safeExternalUrl(catalog.settings.facebook ?? "")

  const maps = safeExternalUrl(catalog.settings.mapsUrl)

  const openBooking = (serviceId = selectedService) => {
    setMenuOpen(false)
    setSelectedService(serviceId || services[0]?.id || "")
    setBookingOpen(true)
  }

  const navigation = [
    [t("Servicios", "Services"), "servicios"],
    [t("Galería", "Gallery"), "galeria"],
    [t("Barberos", "Barbers"), "barberos"],
    [t("Ubicación", "Location"), "ubicacion"],
  ]

  const contactLinks = [
    [instagram, "Instagram"],
    [tiktok, "TikTok"],
    [facebook, "Facebook"],
    [whatsapp, "WhatsApp"],
  ].filter(([url]) => url)

  const provisional = !catalog.settings.businessDataConfirmed
  const hours = openingHours(catalog.barbers, language)

  return (
    <main>
      <a className="skip-link" href="#contenido">
        {t("Saltar al contenido", "Skip to content")}
      </a>
      <header className="site-header">
        <a className="brand" href="#inicio" aria-label="ElMorenaje Cuts">
          <img src="/el-morenaje-logo.png" alt="" />
          <span>
            EL MORENAJE<small>CUTS</small>
          </span>
        </a>
        <nav
          id="site-navigation"
          ref={navRef}
          className={menuOpen ? "open" : ""}
          aria-label={t("Navegación principal", "Main navigation")}
          inert={mobile && !menuOpen}
          aria-hidden={mobile && !menuOpen ? true : undefined}
        >
          {navigation.map(([label, anchor]) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <div
            className="language-switch"
            role="group"
            aria-label={t("Idioma", "Language")}
          >
            {(["es", "en"] as const).map((item) => (
              <button
                key={item}
                type="button"
                lang={item}
                aria-label={item === "es" ? "Español" : "English"}
                aria-pressed={language === item}
                onClick={() => setLanguage(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          <Button className="header-cta" onClick={() => openBooking()}>
            {t("Reservar cita", "Book a visit")}
            <Icon name="arrow" />
          </Button>
          <button
            ref={menuButtonRef}
            className="menu-button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={
              menuOpen
                ? t("Cerrar menú", "Close menu")
                : t("Abrir menú", "Open menu")
            }
            aria-expanded={menuOpen}
            aria-controls="site-navigation"
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </header>

      <section className="hero" id="inicio">
        <div className="hero__photo">
          <img
            src={hero?.url || "/el-morenaje-logo.png"}
            className={hero ? undefined : "brand-photo-placeholder"}
            fetchPriority="high"
            decoding="async"
            alt={
              hero?.alt[language] ||
              t(
                "ElMorenaje Cuts",
                "ElMorenaje Cuts",
              )
            }
          />
          <div className="hero__photo-shade" />
          <div className="hero__photo-tag">
            <Icon name="check" size={16} />
            {t("Tu estilo. Tu flow.", "Your style. Your flow.")}
          </div>
        </div>
        <div className="hero__copy" id="contenido" tabIndex={-1}>
          <span className="kicker">
            <i />
            {t("Precisión. Actitud. Calle.", "Precision. Attitude. Street.")}
          </span>
          <h1>
            {t("EL ARTE", "THE ART")}
            <br />
            {t("DEL CORTE", "OF THE CUT")}
            <br />
            <em>{t("URBANO.", "URBAN.")}</em>
          </h1>
          <p>
            {t(
              "Fades limpios, barbas esculpidas y estilo sin pedir permiso. Reserva tu silla. Nosotros hacemos el resto.",
              "Clean fades, sculpted beards and unapologetic style. Request your chair. We take care of the rest.",
            )}
          </p>
          <div className="hero__actions">
            <Button onClick={() => openBooking()}>
              {t("Agendar turno online", "Request a visit online")}
              <Icon name="calendar" />
            </Button>
            <a className="button button--outline" href="#servicios">
              {t("Ver servicios y precios", "Explore services & prices")}
            </a>
          </div>
          <div className="hero__proof">
            <div className="avatar-stack" aria-hidden="true">
              <span>EM</span>
              <span>C</span>
              <span>✦</span>
            </div>
            <div>
              <span className="community-label">EL MORENAJE CUTS</span>
              <small>
                {t("La barbería de la comunidad", "The community barbershop")}
              </small>
            </div>
          </div>
        </div>
        <div className="hero__logo-badge">
          <div className="badge-ring">
            <img
              src="/el-morenaje-logo.png"
              alt={t("Logo ElMorenaje Cuts", "ElMorenaje Cuts logo")}
            />
          </div>
          <span>CURAÇAO</span>
        </div>
        <div className="hero__marquee" aria-hidden="true">
          <div>
            <span>{t("FADES IMPECABLES", "FRESH FADES")}</span>
            <i>✦</i>
            <span>{t("ESTILO URBANO", "URBAN STYLE")}</span>
            <i>✦</i>
            <span>{t("SERVICIO PREMIUM", "PREMIUM SERVICE")}</span>
            <i>✦</i>
            <span>EL MORENAJE CUTS</span>
            <i>✦</i>
            <span>{t("FADES IMPECABLES", "FRESH FADES")}</span>
          </div>
        </div>
      </section>

      {(catalog.mode !== "live" || catalogState !== "ready" || provisional) && (
        <aside className="site-notice" aria-live="polite">
          <span>
            {catalogState === "loading"
              ? t(
                  "Cargando información y disponibilidad…",
                  "Loading information and availability…",
                )
              : catalogState === "error"
                ? t(
                    "La agenda no está disponible. Puedes consultar los servicios y contactos del negocio; no se envían reservas.",
                    "The schedule is unavailable. Explore the business services and contacts; bookings cannot be submitted.",
                  )
                : catalog.mode === "demo"
                  ? t(
                      "Modo demostración: datos de ejemplo, sin citas ni comunicaciones reales.",
                      "Demo mode: sample data, no real appointments or communications.",
                    )
                  : t(
                      "Sitio en preparación: servicios, precios, equipo y horarios facilitados por el negocio. Falta completar la configuración de la agenda online.",
                      "Site in preparation: services, prices, team and schedules supplied by the business. Online booking setup is still pending.",
                    )}
          </span>
          {catalogState === "error" && (
            <button
              type="button"
              className="back-link"
              onClick={() => setCatalogRetry((value) => value + 1)}
            >
              {t("Reintentar conexión", "Retry connection")}
            </button>
          )}
        </aside>
      )}

      <section className="booking-strip" id="reservar">
        <div className="booking-strip__intro">
          <span className="index" aria-hidden="true">
            01
          </span>
          <span className="kicker">
            {t(
              "Tu próxima visita empieza aquí.",
              "Your next visit starts here.",
            )}
          </span>
          <h2>
            {t("RESERVA TU SILLA.", "REQUEST YOUR CHAIR.")}
            <br />
            {t("ENCUENTRA TU FLOW.", "FIND YOUR FLOW.")}
          </h2>
          <p>
            {t(
              "Elige servicio, barbero y hora. Revisaremos tu solicitud; si no se rechaza, se confirmará automáticamente en dos horas.",
              "Choose your service, barber and time. We review your request; unless declined, it confirms automatically after two hours.",
            )}
          </p>
          {whatsapp && (
            <a
              className="social-link"
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="whatsapp" />
              {t("¿Necesitas una cita antes?", "Need an earlier appointment?")}
            </a>
          )}
        </div>
        <BookingPanel
          catalog={catalog}
          language={language}
          selectedService={selectedService}
          onSelectService={setSelectedService}
        />
      </section>

      <section className="services section" id="servicios">
        <SectionTitle
          kicker={t("Servicios y precios", "Services & prices")}
          title={
            <>
              {t("ELIGE TU", "CHOOSE YOUR")} <em>FLOW.</em>
            </>
          }
          detail={t(
            "Cada corte es personalizado. Sin prisa, sin atajos. Solo precisión y un acabado que habla por sí solo.",
            "Every haircut is personal. No rush, no shortcuts. Just precision and a finish that speaks for itself.",
          )}
        />
        {provisional && (
          <p className="section-note">
            {t(
              "Precios y duraciones facilitados por el negocio. Las reservas online se habilitarán al completar la configuración.",
              "Prices and durations supplied by the business. Online booking will open once setup is complete.",
            )}
          </p>
        )}
        <div className="service-grid">
          {services.map((service, index) => (
            <article
              className={`service-card service-card--${service.accent}`}
              key={service.id}
            >
              <div className="service-card__top">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i />
              </div>
              <h3>{service.name[language]}</h3>
              <p>{service.description[language]}</p>
              <div className="service-card__meta">
                <span>
                  <Icon name="clock" size={16} />
                  {serviceDuration(service, t)}
                </span>
                <strong>{servicePrice(service, language, t)}</strong>
              </div>
              <button onClick={() => openBooking(service.id)}>
                {t("Seleccionar", "Select")}
                <Icon name="arrow" />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="lookbook section" id="galeria">
        <SectionTitle
          kicker={t("El lookbook", "The lookbook")}
          title={
            <>
              {t("CORTES QUE", "CUTS THAT")} <em>{t("HABLAN.", "SPEAK.")}</em>
            </>
          }
          detail={
            t("Cortes y acabados de ElMorenaje Cuts.", "Haircuts and finishes by ElMorenaje Cuts.")
          }
        />
        <div className="lookbook-grid" id="lookbook-photos">
          {gallery.slice(0, visibleGalleryCount).map((photo, index) => (
            <button
              key={photo.url}
              className={`lookbook-card lookbook-card--${(index % 5) + 1}`}
              aria-label={`${t("Ampliar", "Enlarge")}: ${photo.alt[language]}`}
              onClick={() => setLightbox(photo)}
            >
              <img src={photo.url} alt={photo.alt[language]} loading="lazy" decoding="async" />
              <span>
                <small>{String(index + 1).padStart(2, "0")}</small>
                {photo.alt[language]}
              </span>
              <i>
                <Icon name="arrow" />
              </i>
            </button>
          ))}
        </div>
        {gallery.length > 0 ? <div className="lookbook-controls">
          <span role="status">{Math.min(visibleGalleryCount, gallery.length)} {t("de", "of")} {gallery.length} {t("fotografías", "photos")}</span>
          {visibleGalleryCount < gallery.length && <button type="button" className="button button--outline" aria-controls="lookbook-photos" onClick={() => setVisibleGalleryCount(count => count + 5)}>{t("Ver más trabajos", "See more work")}</button>}
        </div> : <p className="lookbook-empty">{t("Pronto compartiremos más trabajos de la barbería.", "More work from the barbershop is coming soon.")}</p>}
        {instagram && (
          <a
            className="social-link"
            href={instagram}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="instagram" />
            {t("Síguenos en", "Follow us on")} <strong>Instagram</strong>
            <Icon name="arrow" />
          </a>
        )}
      </section>

      <section className="barbers section" id="barberos">
        <div className="barbers__image">
          <img
            src={barberPhoto?.url || "/el-morenaje-logo.png"}
            className={barberPhoto ? undefined : "brand-photo-placeholder"}
            alt={
              barberPhoto?.alt[language] ||
              t(
                "ElMorenaje Cuts",
                "ElMorenaje Cuts",
              )
            }
            loading="lazy"
          />
          <div className="barbers__stamp">
            <strong>✦</strong>
            <span>
              {t("Pasión", "Passion")}
              <br />
              {t("por el corte", "for the craft")}
            </span>
          </div>
        </div>
        <div className="barbers__copy">
          <span className="kicker">
            <i />
            {t("El equipo", "The team")}
          </span>
          <h2>
            {t("MANOS EXPERTAS.", "EXPERT HANDS.")}
            <br />
            <em>{t("MENTALIDAD URBANA.", "URBAN MINDSET.")}</em>
          </h2>
          <p>
            {t(
              "Escuchamos tu idea, estudiamos tu estilo y trabajamos cada detalle hasta que el espejo diga exactamente lo que quieres ver.",
              "We listen to your ideas, understand your style and work on every detail until the mirror shows exactly what you want to see.",
            )}
          </p>
          <blockquote>
            {t(
              "“La confianza empieza con un corte que se siente tuyo.”",
              "“Confidence starts with a cut that feels like you.”",
            )}
          </blockquote>
          {catalog.barbers
            .filter((barber) => barber.active)
            .map((barber) => (
              <p className="team-member" key={barber.id}>
                <strong>{barber.name}</strong>
                <span>{barber.specialty[language]}</span>
              </p>
            ))}
          <Button variant="outline" onClick={() => openBooking()}>
            {t("Elige tu barbero", "Choose your barber")}
            <Icon name="arrow" />
          </Button>
        </div>
      </section>

      <section className="location section" id="ubicacion">
        <div className="location__map">
          <iframe
            title={t(
              "Mapa de referencia de Curaçao, no indica la dirección del local",
              "Curaçao reference map, not the barbershop address",
            )}
            src="https://maps.google.com/maps?q=Curacao&t=&z=13&ie=UTF8&iwloc=&output=embed"
            loading="lazy"
          />
          <div className="map-overlay" />
          <div className="map-marker" aria-hidden="true">
            <img src="/el-morenaje-logo.png" alt="" />
          </div>
          <p className="map-caption">
            {t(
              "Referencia de la ciudad · consulta el enlace para la ubicación del local",
              "City reference · use the link for the barbershop location",
            )}
          </p>
        </div>
        <div className="location__content">
          <span className="kicker">
            <i />
            {t("Visítanos", "Visit us")}
          </span>
          <h2>
            {t("CAES POR EL CORTE.", "COME FOR THE CUT.")}
            <br />
            <em>{t("VUELVES POR EL FLOW.", "RETURN FOR THE FLOW.")}</em>
          </h2>
          <div className="rating-card">
            <Icon name="location" size={28} />
            <div>
              <strong>CURAÇAO</strong>
              <small>{t("Estilo de la comunidad", "Community style")}</small>
            </div>
          </div>
          <div className="location-detail">
            <Icon name="location" />
            <div>
              <span>{t("Ubicación", "Location")}</span>
              <strong>
                {catalog.settings.address[language] || "Curaçao"}
              </strong>
              {!catalog.settings.address[language] && (
                <small>
                  {t(
                    "Dirección exacta pendiente de publicación",
                    "Exact address to be published",
                  )}
                </small>
              )}
            </div>
          </div>
          <div className="hours">
            {hours.length ? hours.map(row => <div key={row.label}><span>{row.label}</span><strong>{row.hours}</strong></div>) : <div><span>{t("Horarios", "Opening hours")}</span><strong>{t("Por confirmar", "To be confirmed")}</strong></div>}
          </div>
          <div className="location__actions">
            {maps && (
              <a
                className="button button--primary"
                href={maps}
                target="_blank"
                rel="noreferrer"
              >
                {t("Cómo llegar", "Get directions")}
                <Icon name="arrow" />
              </a>
            )}
            {whatsapp && (
              <a
                className="button button--outline"
                href={whatsapp}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="whatsapp" />
                WhatsApp
              </a>
            )}
            {!maps && !whatsapp && (
              <p className="section-note">
                {t(
                  "Los datos de contacto se publicarán al completar la configuración.",
                  "Contact details will be published once setup is complete.",
                )}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="final-cta">
        <img src="/el-morenaje-logo.png" alt="" />
        <div>
          <span className="kicker">
            {t("Tu próximo estilo empieza aquí", "Your next style starts here")}
          </span>
          <h2>
            {t("¿LISTO PARA TU", "READY FOR YOUR")}
            <br />
            <em>{t("PRÓXIMO LOOK?", "NEXT LOOK?")}</em>
          </h2>
          <Button onClick={() => openBooking()}>
            {t("Solicitar reserva", "Request an appointment")}
            <Icon name="arrow" />
          </Button>
        </div>
      </section>
      <footer>
        <div className="footer__brand">
          <img src="/el-morenaje-logo.png" alt="ElMorenaje Cuts" />
          <p>
            {t("Estilo de la calle.", "Street style.")}
            <br />
            {t("Precisión de barbería.", "Barbershop precision.")}
          </p>
        </div>
        <div className="footer__links">
          <span>{t("Navegación", "Navigation")}</span>
          {navigation.map(([label, anchor]) => (
            <a key={anchor} href={`#${anchor}`}>
              {label}
            </a>
          ))}
        </div>
        <div className="footer__links">
          <span>{t("Conecta", "Connect")}</span>
          {contactLinks.map(([url, label]) => (
            <a key={label} href={url} target="_blank" rel="noreferrer">
              {label}
            </a>
          ))}
          <a href="/admin">{t("Administración", "Administration")}</a>
        </div>
        <div className="footer__book">
          <span>{t("¿Necesitas un corte?", "Need a haircut?")}</span>
          <button onClick={() => openBooking()}>
            {t("Solicita tu turno", "Request your visit")}
            <Icon name="arrow" />
          </button>
        </div>
        <div className="footer__bottom">
          <span>
            © {new Date().getFullYear()} EL MORENAJE CUTS.{" "}
            {t("TODOS LOS DERECHOS RESERVADOS.", "ALL RIGHTS RESERVED.")}
          </span>
          <span>CURAÇAO</span>
        </div>
      </footer>
      {whatsapp && (
        <a
          className="whatsapp-float"
          href={whatsapp}
          target="_blank"
          rel="noreferrer"
          aria-label={t("Contactar por WhatsApp", "Contact us on WhatsApp")}
        >
          <Icon name="whatsapp" size={24} />
          <span>{t("¿Hablamos?", "Let’s talk")}</span>
        </a>
      )}
      <div className="mobile-book-bar">
        <Button onClick={() => openBooking()}>
          {t("Reservar cita", "Book a visit")}
          <Icon name="calendar" />
        </Button>
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            aria-label={t("Contactar por WhatsApp", "Contact us on WhatsApp")}
          >
            <Icon name="whatsapp" />
          </a>
        )}
      </div>
      {bookingOpen && (
        <Dialog
          label={t("Solicitar una cita", "Request an appointment")}
          onClose={() => setBookingOpen(false)}
        >
          <div className="modal">
            <button
              className="modal__close"
              onClick={() => setBookingOpen(false)}
              aria-label={t("Cerrar", "Close")}
            >
              <Icon name="close" />
            </button>
            <BookingPanel
              compact
              catalog={catalog}
              language={language}
              selectedService={selectedService}
              onSelectService={setSelectedService}
            />
          </div>
        </Dialog>
      )}
      {lightbox && (
        <Dialog
          lightbox
          label={t("Imagen ampliada", "Enlarged image")}
          onClose={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            aria-label={t("Cerrar", "Close")}
          >
            <Icon name="close" size={28} />
          </button>
          <img src={lightbox.url} alt={lightbox.alt[language]} />
        </Dialog>
      )}
    </main>
  )
}
