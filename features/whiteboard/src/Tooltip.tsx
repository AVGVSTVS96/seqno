const DELAY_MS = 300
const OFFSET = 10
const ARROW = { width: 10, height: 5 }
const MARGIN = 4

type Side = "top" | "bottom" | "left" | "right"

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" }

const isSide = (value: string | undefined): value is Side =>
  value !== undefined && value in OPPOSITE

const triggerOf = (target: EventTarget | null, root: HTMLElement) => {
  const trigger = target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null

  return trigger !== null && root.contains(trigger) ? trigger : null
}

const fits = (side: Side, at: DOMRect, size: DOMRect) => {
  const room = {
    top: at.top,
    bottom: innerHeight - at.bottom,
    left: at.left,
    right: innerWidth - at.right,
  }[side]

  return room >= (side === "top" || side === "bottom" ? size.height : size.width) + OFFSET
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const place = (trigger: HTMLElement, tip: HTMLElement) => {
  const asked = trigger.closest<HTMLElement>("[data-tooltip-side]")?.dataset["tooltipSide"]
  const wanted = isSide(asked) ? asked : "top"
  const at = trigger.getBoundingClientRect()
  const size = tip.getBoundingClientRect()

  const side =
    fits(wanted, at, size) || !fits(OPPOSITE[wanted], at, size) ? wanted : OPPOSITE[wanted]

  const vertical = side === "top" || side === "bottom"

  const left = vertical
    ? clamp(at.left + at.width / 2 - size.width / 2, MARGIN, innerWidth - size.width - MARGIN)
    : side === "left"
      ? at.left - OFFSET - size.width
      : at.right + OFFSET

  const top = vertical
    ? side === "top"
      ? at.top - OFFSET - size.height
      : at.bottom + OFFSET
    : clamp(at.top + at.height / 2 - size.height / 2, MARGIN, innerHeight - size.height - MARGIN)

  const arrow = vertical ? at.left + at.width / 2 - left : at.top + at.height / 2 - top
  tip.dataset["side"] = side
  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
  tip.style.setProperty("--wb-tooltip-arrow", `${arrow - ARROW.width / 2}px`)
}

const attach = (tip: HTMLDivElement | null) => {
  if (tip === null) {
    return
  }

  const root = tip.parentElement
  const label = tip.querySelector<HTMLElement>(".wb-tooltip-label")
  const keys = tip.querySelector<HTMLElement>(".wb-tooltip-keys")

  if (root === null || label === null || keys === null) {
    return
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let current: HTMLElement | null = null

  const show = (trigger: HTMLElement, delayed: boolean) => {
    if (!trigger.isConnected) {
      return
    }

    label.textContent = trigger.dataset["tooltip"] ?? ""
    keys.textContent = trigger.dataset["tooltipKeys"] ?? ""
    keys.hidden = trigger.dataset["tooltipKeys"] === undefined
    tip.dataset["state"] = delayed ? "delayed-open" : "instant-open"
    tip.showPopover()
    place(trigger, tip)
  }

  const hide = () => {
    clearTimeout(timer)
    current = null
    tip.dataset["state"] = "closed"

    if (tip.matches(":popover-open")) {
      tip.hidePopover()
    }
  }

  const over = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      return
    }

    const trigger = triggerOf(event.target, root)

    if (trigger === current) {
      return
    }

    hide()

    if (trigger === null) {
      return
    }

    current = trigger
    timer = setTimeout(() => {
      show(trigger, true)
    }, DELAY_MS)
  }

  const leave = (event: PointerEvent) => {
    if (!(event.relatedTarget instanceof Node && root.contains(event.relatedTarget))) {
      hide()
    }
  }

  const press = (event: PointerEvent) => {
    hide()
    current = triggerOf(event.target, root)
  }

  const focus = (event: FocusEvent) => {
    const trigger = triggerOf(event.target, root)

    if (trigger === null || !trigger.matches(":focus-visible")) {
      return
    }

    hide()
    current = trigger
    show(trigger, false)
  }

  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      hide()
    }
  }

  root.addEventListener("pointerover", over)
  root.addEventListener("pointerleave", leave)
  root.addEventListener("pointerdown", press, true)
  root.addEventListener("wheel", hide, { passive: true })
  root.addEventListener("focusin", focus)
  root.addEventListener("focusout", hide)
  root.addEventListener("keydown", key, true)

  return () => {
    clearTimeout(timer)
    root.removeEventListener("pointerover", over)
    root.removeEventListener("pointerleave", leave)
    root.removeEventListener("pointerdown", press, true)
    root.removeEventListener("wheel", hide)
    root.removeEventListener("focusin", focus)
    root.removeEventListener("focusout", hide)
    root.removeEventListener("keydown", key, true)
  }
}

export const Tooltip = () => (
  <div ref={attach} popover="manual" role="tooltip" className="wb-tooltip" data-state="closed">
    <span className="wb-tooltip-label" />
    <span className="wb-tooltip-keys" hidden />
    <svg
      className="wb-tooltip-arrow"
      width={ARROW.width}
      height={ARROW.height}
      viewBox="0 0 30 10"
      preserveAspectRatio="none"
    >
      <polygon points="0,0 30,0 15,10" />
    </svg>
  </div>
)
