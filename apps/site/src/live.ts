import { inView } from "motion"
import { app } from "./Actions.tsx"
import { reduced } from "./reveal.ts"

const bar = 32
const px = (n: number) => `${n}px`
const ease = "cubic-bezier(0.32, 0.72, 0, 1)"

export function live(figure: HTMLElement | null) {
  if (!figure) return
  const capable =
    document.documentElement.dataset.browser === "chromium" && matchMedia("(pointer: fine)").matches
  if (!capable) return

  const slot = figure.querySelector<HTMLElement>(".slot")!
  const box = figure.querySelector<HTMLElement>(".window")!
  const screen = figure.querySelector<HTMLElement>(".screen")!
  const zoom = figure.querySelector<HTMLButtonElement>(".zoom")!
  const shield = figure.querySelector<HTMLButtonElement>(".shield")!
  const frame = document.createElement("iframe")
  frame.title = "seqno, running live"
  frame.allow = "clipboard-read; clipboard-write"

  const viewport = () => {
    const { clientWidth, clientHeight } = document.documentElement
    return { width: clientWidth, height: clientHeight }
  }
  const fit = () => {
    const { width, height } = viewport()
    figure.style.setProperty("--vw", px(width))
    figure.style.setProperty("--vh", px(height - bar))
    figure.style.setProperty("--scale", String(slot.clientWidth / width))
  }
  fit()
  figure.dataset.state = "loading"
  const resized = new ResizeObserver(fit)
  resized.observe(document.documentElement)

  const stopLoading = inView(
    figure,
    () => {
      stopLoading()
      frame.src = `${app}?embed`
      screen.append(frame)
    },
    { margin: "0px 0px 25% 0px" },
  )

  let zoomed = false
  let run = 0

  const setZoomed = (on: boolean) => {
    zoomed = on
    zoom.setAttribute("aria-expanded", String(on))
    zoom.querySelector("span")!.textContent = on ? "Close" : "Full screen"
  }

  const move = async (open: boolean) => {
    const mine = ++run
    const from = box.getBoundingClientRect()
    for (const animation of [...box.getAnimations(), ...frame.getAnimations()]) animation.cancel()
    if (open) {
      slot.style.height = px(slot.offsetHeight)
      figure.dataset.zoom = ""
      document.documentElement.dataset.locked = ""
    } else {
      delete document.documentElement.dataset.locked
      delete figure.dataset.active
    }
    fit()
    setZoomed(open)
    const full = viewport()
    const to = open ? new DOMRect(0, 0, full.width, full.height) : slot.getBoundingClientRect()
    if (open) frame.focus({ preventScroll: true })
    if (!reduced()) {
      const timing = { duration: open ? 460 : 360, easing: ease }
      const rect = (r: DOMRect, radius: number) => ({
        top: px(r.top),
        left: px(r.left),
        width: px(r.width),
        height: px(r.height),
        borderRadius: px(radius),
      })
      const scale = (r: DOMRect) => ({ transform: `scale(${r.width / full.width})` })
      await Promise.all([
        box.animate([rect(from, open ? 12 : 0), rect(to, open ? 0 : 12)], timing).finished,
        frame.animate([scale(from), scale(to)], timing).finished,
      ]).catch(() => {})
    }
    if (mine !== run || open) return
    delete figure.dataset.zoom
    slot.style.height = ""
    zoom.focus()
  }

  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== frame.contentWindow) return
    const data = event.data
    const type = typeof data === "object" && data !== null ? Reflect.get(data, "type") : null
    if (type === "seqno:ready") figure.dataset.state = "live"
    if (type === "seqno:escape" && zoomed) void move(false)
  }

  const onClick = () => void move(!zoomed)
  const activate = () => {
    figure.dataset.active = ""
    frame.focus({ preventScroll: true })
  }
  const deactivate = () => {
    if (!zoomed) delete figure.dataset.active
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && zoomed) void move(false)
  }

  addEventListener("resize", fit)
  addEventListener("message", onMessage)
  addEventListener("keydown", onKey)
  addEventListener("scroll", deactivate, { passive: true })
  zoom.addEventListener("click", onClick)
  shield.addEventListener("click", activate)
  return () => {
    stopLoading()
    removeEventListener("resize", fit)
    removeEventListener("message", onMessage)
    removeEventListener("keydown", onKey)
    removeEventListener("scroll", deactivate)
    zoom.removeEventListener("click", onClick)
    shield.removeEventListener("click", activate)
    resized.disconnect()
  }
}
