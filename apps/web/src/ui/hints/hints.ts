import type { RegisteredRouter } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity"
import { openGraph, rightSidebar, searchOpen, type SidebarItem } from "../../atoms.ts"
import { isDemoGraph, type DemoGraph } from "../../graph-locations.ts"
import { contentsItem } from "../shell/listeners.ts"
import { dismissedHints } from "../shell/state.ts"
import { clipper, fullyVisible, readableContent, viewport } from "./measure.ts"
import { placeTip, type Placement, type Point } from "./place.ts"

export type HintId =
  | "contents"
  | "graph-menu"
  | "page-link"
  | "shift-click"
  | "references"
  | "search"

export interface Spot {
  readonly selector: string
  readonly text: string
  readonly keys?: ReadonlyArray<string>
  readonly done?: "click" | "click-within" | "opened"
}

interface Hint {
  readonly id: HintId
  readonly key: string
  readonly spots: ReadonlyArray<Spot>
}

export interface ShownHint {
  readonly id: HintId
  readonly key: string
  readonly spot: Spot
}

export interface HintState {
  readonly active: string | null
  readonly shown: ReadonlyArray<ShownHint>
}

const graphNames: Record<DemoGraph, string> = {
  demo: "the Getting started graph",
  developer: "the Developer graph",
}

const mainPage = ".main-content > .seqno-page"

const hintsFor = (graph: DemoGraph): ReadonlyArray<Hint> => [
  {
    id: "contents",
    key: "contents",
    spots: [
      {
        selector: '.right-sidebar[data-open="true"] [data-hint-anchor="contents"]',
        text: "Contents is a page you write yourself. Keep the links you use most here.",
        done: "click",
      },
    ],
  },
  {
    id: "graph-menu",
    key: `graph-menu:${graph}`,
    spots: [
      {
        selector: '.app[data-left-open="true"] [data-hint-anchor="graph-menu"]',
        text: `This is ${graphNames[graph]}. Switch graphs here.`,
        done: "opened",
      },
      {
        selector: '.app[data-left-open="false"] [data-hint-anchor="left-sidebar"]',
        text: `This is ${graphNames[graph]}. Switch graphs from the left sidebar.`,
      },
    ],
  },
  {
    id: "page-link",
    key: "page-link",
    spots: [
      {
        selector: ".main-content .seqno-journal .seqno-page-blocks .seqno-pageref-link",
        text: "Click to open this page.",
      },
    ],
  },
  {
    id: "shift-click",
    key: "shift-click",
    spots: [
      {
        selector: `${mainPage} .seqno-page-title-text`,
        text: "Shift-click any link on this page to open it in the sidebar, next to this one.",
      },
    ],
  },
  {
    id: "references",
    key: "references",
    spots: [
      {
        selector: `${mainPage} > .seqno-page-references > :first-child .seqno-references-title > button`,
        text: "Every block that links to this page shows up here. This is where ideas meet.",
        done: "click-within",
      },
    ],
  },
  {
    id: "search",
    key: "search",
    spots: [
      {
        selector: '[data-hint-anchor="search"]',
        text: "Search every page and block.",
        keys: ["mod", "k"],
      },
    ],
  },
]

export const anchorName = (id: HintId) => `--hint-${id}`

const none: HintState = { active: null, shown: [] }

export const hintState = Atom.make<HintState>(none).pipe(Atom.keepAlive)

const openedFromLink = (item: SidebarItem) =>
  item._tag === "Block" || (item._tag === "Page" && item.name !== contentsItem.name)

const grace = 700
const readTime = 1500
const restRadius = 8
const nearTarget = 8

const busy = '[role="menu"]:popover-open, dialog[open]'

const typing = () => {
  const focused = document.activeElement
  return (
    focused instanceof HTMLElement &&
    (focused.isContentEditable || focused.matches("input, textarea, select"))
  )
}

const transitionsMoving = (elements: ReadonlyArray<Element>) =>
  document.getAnimations().filter((animation) => {
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null
    return (
      animation instanceof CSSTransition &&
      animation.playState === "running" &&
      target !== null &&
      elements.some((element) => target.contains(element))
    )
  })

const inTip = (node: Node) =>
  (node instanceof Element ? node : node.parentElement)?.closest(".hint") != null

const outsideTips = (record: MutationRecord) => {
  const nodes = [...record.addedNodes, ...record.removedNodes]
  return !inTip(record.target) && (nodes.length === 0 || !nodes.every(inTip))
}

const near = (element: Element, pointer: Point | null) => {
  if (pointer === null) return false
  const box = element.getBoundingClientRect()
  return (
    pointer.x >= box.left - nearTarget &&
    pointer.x <= box.right + nearTarget &&
    pointer.y >= box.top - nearTarget &&
    pointer.y <= box.bottom + nearTarget
  )
}

const tipFor = (key: string) => {
  const tip = document.querySelector(`.hint[data-key="${CSS.escape(key)}"]`)
  return tip instanceof HTMLElement ? tip : null
}

const elementsOf = (spot: Spot) =>
  [...document.querySelectorAll(spot.selector)].filter((element) => element instanceof HTMLElement)

const widths = [272, 232, 200]

const apply = (tip: HTMLElement, element: HTMLElement, placement: Placement) => {
  const anchor = element.getBoundingClientRect()
  tip.dataset["side"] = placement.side
  tip.dataset["lifted"] = String(placement.covered > 0)
  tip.style.setProperty("--hint-x", `${placement.box.left - anchor.left}px`)
  tip.style.setProperty("--hint-y", `${placement.box.top - anchor.top}px`)
  tip.style.setProperty("--hint-caret", `${placement.caret}px`)
  tip.style.setProperty("--hint-width", `${widths[placement.size] ?? 272}px`)
}

const sizesOf = (tip: HTMLElement) => {
  const chosen = tip.style.getPropertyValue("--hint-width")
  const sizes = widths.map((width) => {
    tip.style.setProperty("--hint-width", `${width}px`)
    return { width: tip.offsetWidth, height: tip.offsetHeight }
  })
  tip.style.setProperty("--hint-width", chosen)
  return sizes
}

interface Candidate {
  readonly hint: Hint
  readonly spot: Spot
}

interface Showing {
  readonly tip: HTMLElement
  readonly element: HTMLElement
  readonly placement: Placement
  readonly since: number
}

const track = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter, graph: DemoGraph) => {
  const hints = hintsFor(graph)
  const named = new Map<HintId, HTMLElement>()
  let candidate: Candidate | null = null
  let showing: Showing | null = null
  let pressed = false
  let pointer: Point | null = null
  let rest: Point | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let state = none
  let stopped = false

  const publish = (next: HintState) => {
    state = next
    registry.set(hintState, state)
  }

  const dismiss = (id: HintId) => {
    const dismissed = registry.get(dismissedHints)
    const keys = hints.flatMap((hint) =>
      hint.id === id && !dismissed.includes(hint.key) ? [hint.key] : [],
    )
    if (keys.length > 0) registry.set(dismissedHints, [...dismissed, ...keys])
  }

  const find = (): Candidate | null => {
    const dismissed = registry.get(dismissedHints)
    const visible = clipper()
    const inView = (spot: Spot) => {
      const elements = elementsOf(spot)
      return (
        elements.some((element) => fullyVisible(visible, element)) ||
        transitionsMoving(elements).length > 0
      )
    }
    const found = hints.flatMap((hint) => {
      if (dismissed.includes(hint.key)) return []
      const spot = hint.spots.find((each) => document.querySelector(each.selector) !== null)
      return spot === undefined || !inView(spot) ? [] : [{ hint, spot }]
    })
    const kept = found.find(
      (each) =>
        showing !== null && each.hint.key === candidate?.hint.key && each.spot === candidate.spot,
    )
    return kept ?? found[0] ?? null
  }

  const name = (id: HintId, element: HTMLElement) => {
    const previous = named.get(id)
    if (previous === element) return
    previous?.style.removeProperty("anchor-name")
    element.style.setProperty("anchor-name", anchorName(id))
    named.set(id, element)
  }

  const resized = new ResizeObserver(() => place())

  const hide = () => {
    if (showing === null) return
    showing = null
    resized.disconnect()
    publish({ ...state, active: null })
  }

  const wait = () => {
    clearTimeout(timer)
    timer = setTimeout(settle, grace)
  }

  const occupied = () =>
    typing() || router.state.status !== "idle" || document.querySelector(busy) !== null

  const calm = () => !pressed && !occupied()

  const measure = (
    tip: HTMLElement,
    targets: ReadonlyArray<HTMLElement>,
    current: Placement | null,
  ) => {
    const visible = clipper()
    const shown = targets.filter((target) => fullyVisible(visible, target))
    const placement = placeTip({
      targets: shown.map((target) => target.getBoundingClientRect()),
      sizes: sizesOf(tip),
      viewport: viewport(),
      content: readableContent(visible),
      pointer: current === null ? pointer : null,
      current,
    })
    const element = placement === null ? undefined : shown[placement.target]
    return placement === null || element === undefined ? null : { placement, element }
  }

  const reveal = () => {
    if (candidate === null) return
    const { hint, spot } = candidate
    const tip = tipFor(hint.key)
    if (tip === null) {
      wait()
      return
    }
    const measured = measure(tip, elementsOf(spot), null)
    if (measured === null || near(measured.element, pointer)) return
    name(hint.id, measured.element)
    apply(tip, measured.element, measured.placement)
    // The entrance starts from the before-change style, so the side's closed pose is computed before opening: https://drafts.csswg.org/css-transitions-1/#before-change-style
    getComputedStyle(tip).getPropertyValue("translate")
    showing = {
      tip,
      element: measured.element,
      placement: measured.placement,
      since: performance.now(),
    }
    resized.observe(tip)
    resized.observe(measured.element)
    publish({ ...state, active: hint.key })
  }

  const settle = () => {
    if (stopped || candidate === null || showing !== null || !calm()) return
    const moving = transitionsMoving(elementsOf(candidate.spot))
    if (moving.length > 0) {
      void Promise.allSettled(moving.map((transition) => transition.finished)).then(settle)
      return
    }
    reveal()
  }

  const place = () => {
    if (showing === null) return
    const { tip, element, placement } = showing
    const moving = transitionsMoving([element])
    if (moving.length > 0) {
      void Promise.allSettled(moving.map((transition) => transition.finished)).then(place)
      return
    }
    const measured = element.isConnected
      ? measure(tip, [element], { ...placement, target: 0 })
      : null
    if (measured === null) {
      hide()
      wait()
      return
    }
    apply(tip, element, measured.placement)
    showing = { ...showing, placement: measured.placement }
  }

  const opened = (current: Candidate) =>
    current.spot.done === "opened" &&
    elementsOf(current.spot).some((element) => element.getAttribute("aria-expanded") === "true")

  const candidacy = (found: Candidate | null): HintState => {
    if (found === null) return { ...state, active: null }
    const entry: ShownHint = { id: found.hint.id, key: found.hint.key, spot: found.spot }
    const known = state.shown.some((shown) => shown.key === entry.key)
    return {
      active: null,
      shown: known
        ? state.shown.map((shown) => (shown.key === entry.key ? entry : shown))
        : [...state.shown, entry],
    }
  }

  const refresh = () => {
    if (stopped) return
    if (candidate !== null && opened(candidate)) {
      dismiss(candidate.hint.id)
      return
    }
    if (occupied()) {
      hide()
      return
    }
    const found = find()
    if (found?.hint.key !== candidate?.hint.key || found?.spot !== candidate?.spot) {
      showing = null
      resized.disconnect()
      candidate = found
      publish(candidacy(found))
      wait()
      return
    }
    place()
  }

  const leaveIfUnread = () => {
    if (showing !== null && performance.now() - showing.since < readTime) hide()
  }

  const clicked = (event: MouseEvent) => {
    if (candidate === null || !(event.target instanceof Element)) return
    const { hint, spot } = candidate
    const target = event.target
    const did =
      spot.done === "click"
        ? target.closest(spot.selector) !== null
        : spot.done === "click-within"
          ? elementsOf(spot).some((element) =>
              (element.closest("section") ?? element).contains(target),
            )
          : false
    if (did) dismiss(hint.id)
  }

  const pressedDown = (event: PointerEvent) => {
    pressed = true
    if (!(event.target instanceof Node && inTip(event.target))) leaveIfUnread()
    wait()
  }

  const released = () => {
    pressed = false
    wait()
  }

  const moved = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY }
    if (rest !== null && Math.hypot(pointer.x - rest.x, pointer.y - rest.y) < restRadius) return
    rest = pointer
    if (showing === null) wait()
  }

  const keyed = () => {
    leaveIfUnread()
    wait()
  }

  const scrolled = () => {
    if (showing === null) wait()
  }

  const changed = () => {
    refresh()
    if (showing === null) wait()
  }

  const visited = () => {
    if (router.state.matches.some((match) => match.routeId === "/page/$name")) dismiss("page-link")
  }

  const listeners: ReadonlyArray<readonly [EventTarget, string, EventListener]> = [
    [window, "pointerdown", (event) => event instanceof PointerEvent && pressedDown(event)],
    [window, "pointerup", released],
    [window, "pointercancel", released],
    [window, "pointermove", (event) => event instanceof PointerEvent && moved(event)],
    [window, "keydown", keyed],
    [window, "click", (event) => event instanceof MouseEvent && clicked(event)],
    [window, "scroll", scrolled],
    [window, "scrollend", changed],
    [window, "resize", place],
    [document, "toggle", changed],
    [document, "focusin", changed],
    [document, "focusout", changed],
  ]

  visited()
  refresh()
  const observer = new MutationObserver((records) => {
    if (records.some(outsideTips)) changed()
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-open", "data-left-open", "aria-expanded", "open"],
  })
  listeners.forEach(([target, type, listener]) =>
    target.addEventListener(type, listener, { capture: true, passive: true }),
  )
  const stops = [
    registry.subscribe(dismissedHints, refresh),
    registry.subscribe(searchOpen, (open) => {
      if (open) dismiss("search")
    }),
    registry.subscribe(rightSidebar, ({ items }) => {
      if (items.some(openedFromLink)) dismiss("shift-click")
    }),
    router.subscribe("onResolved", () => {
      visited()
      changed()
    }),
  ]
  return () => {
    stopped = true
    clearTimeout(timer)
    observer.disconnect()
    resized.disconnect()
    listeners.forEach(([target, type, listener]) =>
      target.removeEventListener(type, listener, { capture: true }),
    )
    stops.forEach((stop) => stop())
    named.forEach((element) => element.style.removeProperty("anchor-name"))
    registry.set(hintState, none)
  }
}

export const hintTracker = Atom.family((router: RegisteredRouter) =>
  Atom.make((get) => {
    const result = get(openGraph)
    if (AsyncResult.isWaiting(result)) return
    const graph = Option.getOrNull(Option.map(AsyncResult.value(result), (opened) => opened.graph))
    if (graph === null || !isDemoGraph(graph)) return
    get.addFinalizer(track(get.registry, router, graph))
  }),
)

export const dismissHint = Atom.writable(
  () => null,
  (ctx, key: string) => {
    const dismissed = ctx.get(dismissedHints)
    if (!dismissed.includes(key)) ctx.set(dismissedHints, [...dismissed, key])
  },
)
