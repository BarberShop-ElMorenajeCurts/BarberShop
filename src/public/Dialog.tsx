import { useEffect, useRef, type ReactNode } from "react"

export function Dialog({
  children,
  label,
  onClose,
  lightbox = false,
}: {
  children: ReactNode
  label: string
  onClose: () => void
  lightbox?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const node = ref.current!
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0)
    ;(focusable()[0] ?? node).focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeRef.current()
      }
      if (event.key === "Tab") {
        const elements = focusable()
        const first = elements[0],
          last = elements[elements.length - 1]
        if (!first) {
          event.preventDefault()
          node.focus()
          return
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === node)
        ) {
          event.preventDefault()
          last.focus()
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !node.contains(document.activeElement))
        ) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", handleKey)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener("keydown", handleKey)
      previous?.focus()
    }
  }, [])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={lightbox ? "lightbox" : "modal-backdrop"}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )
}
