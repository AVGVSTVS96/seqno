export interface Place {
  readonly offset: number
  readonly anchor: { readonly key: string; readonly top: number } | null
}

type Locate = (key: string) => number | undefined

const locators = new WeakMap<Element, Set<Locate>>()

const pins = new WeakMap<Element, () => void>()

export const locateOn = (scroller: Element, locate: Locate) => {
  const lists = locators.get(scroller) ?? new Set()
  locators.set(scroller, lists)
  lists.add(locate)
  return () => {
    lists.delete(locate)
  }
}

export const settle = (scroller: Element) => pins.get(scroller)?.()

export const fromTop = (element: Element, scroller: Element) =>
  element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop

const rows = (scroller: Element, key?: string) =>
  scroller.querySelectorAll<HTMLElement>(
    key === undefined
      ? "[role=treeitem][data-block-id]"
      : `[role=treeitem][data-block-id="${key}"]`,
  )

export const placeOf = (scroller: Element): Place => {
  const row = [...rows(scroller)].find((shown) => {
    const top = fromTop(shown, scroller)
    return top >= 0 && top < scroller.clientHeight
  })
  const key = row?.dataset["blockId"]
  const offset = scroller.scrollTop
  return {
    offset,
    anchor:
      offset < 1 || row === undefined || key === undefined
        ? null
        : { key, top: fromTop(row, scroller) },
  }
}

const userActs = ["wheel", "pointerdown", "keydown", "touchstart", "focusin"] as const

export const restorePlace = (scroller: Element, { offset, anchor }: Place) => {
  let found = false
  const anchored = () => {
    if (anchor === null) return undefined
    const shown = [...rows(scroller, anchor.key)]
      .map((row) => fromTop(row, scroller) - anchor.top)
      .toSorted((a, b) => Math.abs(a) - Math.abs(b))[0]
    if (shown !== undefined) return scroller.scrollTop + shown
    const start = [...(locators.get(scroller) ?? [])]
      .map((locate) => locate(anchor.key))
      .find((located) => located !== undefined)
    return start === undefined ? undefined : start - anchor.top
  }
  const observer = new ResizeObserver(() => pin())
  const stop = () => {
    observer.disconnect()
    for (const type of userActs) window.removeEventListener(type, act, true)
    if (pins.get(scroller) === pin) pins.delete(scroller)
  }
  const act = (event: Event) => {
    if (!(event instanceof WheelEvent) || event.deltaY !== 0) stop()
  }
  const pin = () => {
    const target = anchored()
    if (target === undefined && found) return stop()
    found ||= target !== undefined
    const top = target ?? offset
    if (Math.abs(scroller.scrollTop - top) >= 1) scroller.scrollTop = top
    if (anchor === null && Math.abs(scroller.scrollTop - top) < 1) stop()
  }
  pins.set(scroller, pin)
  const content = scroller.firstElementChild
  if (content !== null) observer.observe(content)
  for (const type of userActs) window.addEventListener(type, act, { capture: true, passive: true })
  pin()
  return stop
}
