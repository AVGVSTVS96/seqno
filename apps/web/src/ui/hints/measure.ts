import type { Box } from "./place.ts"

const solid =
  'img, svg, video, canvas, iframe, input, textarea, select, button, a[href], [role="button"], .seqno-bullet, .seqno-pageref'

const tips = ".hint"

export const viewport = (): Box => ({
  left: 0,
  top: 0,
  right: document.documentElement.clientWidth,
  bottom: document.documentElement.clientHeight,
})

const intersect = (a: Box, b: Box): Box => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
})

const empty = (box: Box) => box.right <= box.left || box.bottom <= box.top

const clips = (style: CSSStyleDeclaration) =>
  style.overflowX !== "visible" || style.overflowY !== "visible"

export const clipper = () => {
  const known = new Map<Element, Box>()
  const clipOf = (element: Element | null): Box => {
    if (element === null) return viewport()
    const cached = known.get(element)
    if (cached !== undefined) return cached
    const outer = clipOf(element.parentElement)
    const clip = clips(getComputedStyle(element))
      ? intersect(outer, element.getBoundingClientRect())
      : outer
    known.set(element, clip)
    return clip
  }
  return (element: Element, box: Box): Box | null => {
    const visible = intersect(box, clipOf(element.parentElement))
    return empty(visible) ? null : visible
  }
}

const seen = (element: Element) =>
  element.closest(tips) === null &&
  element.checkVisibility({ opacityProperty: true, visibilityProperty: true })

export const readableContent = (visible: ReturnType<typeof clipper>): ReadonlyArray<Box> => {
  const lines: Array<Box> = []
  const range = document.createRange()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent === null || node.textContent?.trim() === "" || !seen(parent)) continue
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      const line = visible(parent, rect)
      if (line !== null) lines.push(line)
    }
  }
  for (const element of document.body.querySelectorAll(solid)) {
    if (!seen(element)) continue
    for (const rect of element.getClientRects()) {
      const box = visible(element, rect)
      if (box !== null) lines.push(box)
    }
  }
  return lines
}

export const fullyVisible = (visible: ReturnType<typeof clipper>, element: Element) => {
  const box = element.getBoundingClientRect()
  const shown = visible(element, box)
  return (
    shown !== null &&
    element.getClientRects().length === 1 &&
    shown.left - box.left < 1 &&
    shown.top - box.top < 1 &&
    box.right - shown.right < 1 &&
    box.bottom - shown.bottom < 1
  )
}
