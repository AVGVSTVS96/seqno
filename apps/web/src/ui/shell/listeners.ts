import type { ParsedLocation, RegisteredRouter } from "@tanstack/react-router"
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity"
import { normalizePageName } from "@seqno/domain"
import {
  journals,
  leftSidebarOpen,
  openGraph,
  resolvedTheme,
  rightSidebar,
  theme,
  type SidebarItem,
} from "../../atoms.ts"
import { toggleDialog, togglePopover } from "./popover.tsx"
import { idle, nextKeyState, type KeyState, type ShortcutAction } from "./shortcuts.ts"
import { recentPages, remember, wideMode } from "./state.ts"

export const contentsItem = { _tag: "Page", name: "contents" } as const satisfies SidebarItem

export const helpMenuId = "seqno-help"

export const shortcutsDialogId = "seqno-shortcuts"

export const closeSidebarItem = (registry: AtomRegistry.AtomRegistry, item: SidebarItem) => {
  const { items } = registry.get(rightSidebar)
  registry.set(rightSidebar, items.length <= 1 ? { _tag: "Clear" } : { _tag: "Close", item })
}

const dayNumber = (date: Date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable], [role=menu], dialog") !== null)

const keyState = Atom.make<KeyState>(idle).pipe(Atom.keepAlive)

const perform = (
  registry: AtomRegistry.AtomRegistry,
  router: RegisteredRouter,
): Record<ShortcutAction, () => void> => ({
  ToggleTheme: () => registry.set(theme, registry.get(resolvedTheme) === "dark" ? "light" : "dark"),
  ToggleLeftSidebar: () => registry.set(leftSidebarOpen, !registry.get(leftSidebarOpen)),
  ToggleRightSidebar: () => registry.set(rightSidebar, { _tag: "Toggle" }),
  ToggleWideMode: () => registry.set(wideMode, !registry.get(wideMode)),
  ToggleHelp: () => togglePopover(helpMenuId),
  GoJournals: () => void router.navigate({ to: "/" }),
  GoHome: () => void router.navigate({ to: "/" }),
  GoAllPages: () => void router.navigate({ to: "/all-pages" }),
  GoShortcuts: () => toggleDialog(shortcutsDialogId),
  CloseTopSidebarItem: () => {
    const { open, items } = registry.get(rightSidebar)
    const top = items[0]
    if (open && top !== undefined) closeSidebarItem(registry, top)
  },
  ToggleContents: () => {
    const { open, items } = registry.get(rightSidebar)
    const top = items[0]
    const shown = open && top?._tag === "Page" && top.name === contentsItem.name
    if (shown) closeSidebarItem(registry, contentsItem)
    else registry.set(rightSidebar, { _tag: "Open", item: contentsItem })
  },
  OpenTodayInSidebar: () => {
    const today = registry.get(journals).find((page) => page.journalDay === dayNumber(new Date()))
    if (today !== undefined) {
      registry.set(rightSidebar, { _tag: "Open", item: { _tag: "Page", name: today.name } })
    }
  },
})

const recordVisit = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter) => {
  const opened = registry.get(openGraph)
  const visited = router.state.matches.flatMap((match) =>
    match.routeId === "/page/$name" ? [match.params.name] : [],
  )[0]
  if (!AsyncResult.isSuccess(opened) || visited === undefined) return
  const graph = opened.value.graph
  const all = registry.get(recentPages)
  const next = remember(all[graph] ?? [], normalizePageName(visited))
  if (next !== all[graph]) registry.set(recentPages, { ...all, [graph]: next })
}

const nothing = (): void => undefined

const userScrolls = ["wheel", "pointerdown", "keydown", "touchstart"] as const

const mainColumn = () => document.querySelector<HTMLElement>(".main-content-container")

const keyOf = (location: ParsedLocation) => location.state.key ?? location.href

const scrollWhenTall = (main: HTMLElement, target: number) => {
  main.scrollTop = target
  const content = main.firstElementChild
  if (main.scrollTop === target || content === null) return nothing
  const observer = new ResizeObserver(() => {
    if (main.scrollHeight - main.clientHeight < target) return
    main.scrollTop = target
    stop()
  })
  const stop = () => {
    observer.disconnect()
    for (const type of userScrolls) main.removeEventListener(type, stop)
  }
  observer.observe(content)
  for (const type of userScrolls) main.addEventListener(type, stop, { passive: true })
  return stop
}

const scrollMemory = (router: RegisteredRouter) => {
  const offsets = new Map<string, number>()
  let stopWaiting = nothing
  const stopSaving = router.subscribe("onBeforeLoad", ({ fromLocation }) => {
    const main = mainColumn()
    if (fromLocation !== undefined && main !== null)
      offsets.set(keyOf(fromLocation), main.scrollTop)
  })
  const stopRestoring = router.subscribe("onRendered", ({ toLocation }) => {
    stopWaiting()
    const main = mainColumn()
    if (main !== null) stopWaiting = scrollWhenTall(main, offsets.get(keyOf(toLocation)) ?? 0)
  })
  return () => {
    stopSaving()
    stopRestoring()
    stopWaiting()
  }
}

export const shellListeners = Atom.family((router: RegisteredRouter) =>
  Atom.make((get) => {
    const registry = get.registry
    const actions = perform(registry, router)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) {
        registry.set(keyState, idle)
        return
      }
      const next = nextKeyState(registry.get(keyState), event)
      registry.set(keyState, next)
      if (next.action === null) return
      event.preventDefault()
      actions[next.action]()
    }
    document.addEventListener("keydown", onKeyDown)
    const stopVisits = router.subscribe("onResolved", () => recordVisit(registry, router))
    const stopScrollMemory = scrollMemory(router)
    recordVisit(registry, router)
    get.addFinalizer(() => {
      document.removeEventListener("keydown", onKeyDown)
      stopVisits()
      stopScrollMemory()
    })
  }),
)
