import { inView } from "motion"
import { animate } from "motion/mini"
import { spring } from "./motion.ts"

export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches

export function offscreen(element: HTMLElement) {
  return !reduced() && element.getBoundingClientRect().top > innerHeight
}

export function reveal(row: HTMLElement | null) {
  if (!row || !offscreen(row)) return
  row.style.opacity = "0"
  row.style.transform = "translateY(8px)"
  row.style.setProperty("--dot", "0")
  const stop = inView(
    row,
    () => {
      stop()
      animate(
        row,
        { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0)"], "--dot": [0, 1] },
        spring.base,
      )
    },
    { margin: "0px 0px -12% 0px" },
  )
  return stop
}
