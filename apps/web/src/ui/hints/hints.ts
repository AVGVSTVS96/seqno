import type { RegisteredRouter } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity"
import { openGraph, rightSidebar, searchOpen, type SidebarItem } from "../../atoms.ts"
import { isDemoGraph, type DemoGraph } from "../../graph-locations.ts"
import { contentsItem } from "../shell/listeners.ts"
import { dismissedHints } from "../shell/state.ts"

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
        selector: `${mainPage} .seqno-page-blocks .seqno-pageref-link`,
        text: "Shift-click a link to open it in the sidebar, next to this page.",
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

const busy = '[role="menu"]:popover-open, dialog[open]'

const transitionsMoving = (element: Element) =>
  document
    .getAnimations()
    .filter(
      (animation) =>
        animation instanceof CSSTransition &&
        animation.playState === "running" &&
        animation.effect instanceof KeyframeEffect &&
        animation.effect.target?.contains(element) === true,
    )

interface Anchored {
  readonly hint: Hint
  readonly spot: Spot
  readonly element: HTMLElement
}

const track = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter, graph: DemoGraph) => {
  const hints = hintsFor(graph)
  const named = new Map<HintId, HTMLElement>()
  let anchored: Anchored | null = null
  let zone: Element | null = null
  let state = none
  let stopped = false

  const dismiss = (id: HintId) => {
    const dismissed = registry.get(dismissedHints)
    const keys = hints.flatMap((hint) =>
      hint.id === id && !dismissed.includes(hint.key) ? [hint.key] : [],
    )
    if (keys.length > 0) registry.set(dismissedHints, [...dismissed, ...keys])
  }

  const done = () => {
    if (anchored !== null) dismiss(anchored.hint.id)
  }

  const find = (): Anchored | null => {
    const dismissed = registry.get(dismissedHints)
    for (const hint of hints) {
      if (dismissed.includes(hint.key)) continue
      for (const spot of hint.spots) {
        const element = document.querySelector(spot.selector)
        if (element instanceof HTMLElement) return { hint, spot, element }
      }
    }
    return null
  }

  const name = (id: HintId, element: HTMLElement) => {
    const previous = named.get(id)
    if (previous === element) return
    previous?.style.removeProperty("anchor-name")
    element.style.setProperty("anchor-name", anchorName(id))
    named.set(id, element)
  }

  const show = (found: Anchored | null): HintState => {
    if (found === null) return { ...state, active: null }
    const entry: ShownHint = { id: found.hint.id, key: found.hint.key, spot: found.spot }
    const known = state.shown.some((shown) => shown.key === entry.key)
    return {
      active: entry.key,
      shown: known
        ? state.shown.map((shown) => (shown.key === entry.key ? entry : shown))
        : [...state.shown, entry],
    }
  }

  const opened = (shown: Anchored) =>
    shown.spot.done === "opened" &&
    shown.element.getAttribute("aria-expanded") === "true" &&
    !registry.get(dismissedHints).includes(shown.hint.key)

  const locate = () => {
    if (stopped) return
    if (anchored !== null && opened(anchored)) {
      dismiss(anchored.hint.id)
      return
    }
    const found = document.querySelector(busy) === null ? find() : null
    const moving = found === null ? [] : transitionsMoving(found.element)
    if (moving.length > 0) {
      void Promise.allSettled(moving.map((transition) => transition.finished)).then(locate)
      return
    }
    if (found?.element === anchored?.element && found?.spot === anchored?.spot) return
    zone?.removeEventListener("click", done)
    zone = null
    anchored = found
    if (found !== null) {
      name(found.hint.id, found.element)
      zone =
        found.spot.done === "click"
          ? found.element
          : found.spot.done === "click-within"
            ? (found.element.closest("section") ?? found.element)
            : null
      zone?.addEventListener("click", done)
    }
    state = show(found)
    registry.set(hintState, state)
  }

  const visited = () => {
    if (router.state.matches.some((match) => match.routeId === "/page/$name")) dismiss("page-link")
  }

  visited()
  locate()
  const observer = new MutationObserver(locate)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-open", "data-left-open", "aria-expanded", "open"],
  })
  const stops = [
    registry.subscribe(dismissedHints, locate),
    registry.subscribe(searchOpen, (open) => {
      if (open) dismiss("search")
    }),
    registry.subscribe(rightSidebar, ({ items }) => {
      if (items.some(openedFromLink)) dismiss("shift-click")
    }),
    router.subscribe("onResolved", visited),
  ]
  return () => {
    stopped = true
    observer.disconnect()
    zone?.removeEventListener("click", done)
    stops.forEach((stop) => stop())
    named.forEach((element) => element.style.removeProperty("anchor-name"))
    registry.set(hintState, none)
  }
}

export const hintTracker = Atom.family((router: RegisteredRouter) =>
  Atom.make((get) => {
    const graph = Option.getOrNull(
      Option.map(AsyncResult.value(get(openGraph)), (opened) => opened.graph),
    )
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
