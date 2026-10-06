import type { RegisteredRouter } from "@tanstack/react-router"
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
import { dayNumber } from "./today.ts"

export const contentsItem = { _tag: "Page", name: "contents" } as const satisfies SidebarItem

export const helpMenuId = "seqno-help"

export const shortcutsDialogId = "seqno-shortcuts"

export const closeSidebarItem = (registry: AtomRegistry.AtomRegistry, item: SidebarItem) => {
  const { items } = registry.get(rightSidebar)
  registry.set(rightSidebar, items.length <= 1 ? { _tag: "Clear" } : { _tag: "Close", item })
}

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
    recordVisit(registry, router)
    get.addFinalizer(() => {
      document.removeEventListener("keydown", onKeyDown)
      stopVisits()
    })
  }),
)
