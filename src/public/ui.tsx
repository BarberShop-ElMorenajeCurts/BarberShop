import type { ReactNode } from "react"

type IconName = "arrow" | "calendar" | "check" | "chevron" | "clock" | "close" | "instagram" | "location" | "menu" | "play" | "star" | "whatsapp"

type IconProps = {
  name: IconName
  size?: number
  filled?: boolean
}

export function Icon({ name, size = 20, filled = false }: IconProps) {
  const paths: Record<IconName, ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m14 7 5 5-5 5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    instagram: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <path d="M17.5 6.5h.01" />
      </>
    ),
    location: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    play: <path d="m9 7 8 5-8 5Z" />,
    star: (
      <path d="m12 2.8 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9L6.4 20l1.1-6.2L3 9.4l6.2-.9Z" />
    ),
    whatsapp: (
      <>
        <path d="M20 11.5a8 8 0 0 1-11.8 7l-4.2 1 1.2-4A8 8 0 1 1 20 11.5Z" />
        <path d="M9 8.5c.5 3 2 4.5 5 5" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

export function Button({
  children,
  variant = "primary",
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode
  variant?: "primary" | "outline" | "ghost"
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      className={`button button--${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function SectionTitle({
  kicker,
  title,
  detail,
}: {
  kicker: string
  title: ReactNode
  detail?: string
}) {
  return (
    <div className="section-title">
      <div>
        <span className="kicker">
          <i />
          {kicker}
        </span>
        <h2>{title}</h2>
      </div>
      {detail && <p>{detail}</p>}
    </div>
  )
}
