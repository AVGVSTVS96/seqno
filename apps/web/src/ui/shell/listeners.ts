import type { ParsedLocation, RegisteredRouter } from "@tanstack/react-router"
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity"
import { normalizePageName, type Command } from "@seqno/domain"
import { journalDate, journalTitle, shiftDays } from "@seqno/editor"
import {
  dispatchAllAtom,
  historyAtom,
  historyStep,
  pageTreeAtom,
  placeOf,
  restorePlace,
  type Place,
} from "@seqno/outliner"
import {
  allPages,
  journals,
  leftSidebarOpen,
  openGraph,
  resolvedTheme,
  rightSidebar,
  theme,
  toggleBrackets,
  toggleFavorite,
  type SidebarItem,
} from "../../atoms.ts"
import { createWhiteboard } from "../pages/Whiteboards.tsx"
import { openPlugins } from "../plugins/PluginsDialog.tsx"
import { dayOf } from "../pages/model.ts"
import { openPalette } from "../search/atoms.ts"
import { graphSelect } from "./GraphSelect.tsx"
import { rebuildIndex } from "./reindex.ts"
import { openDialog, togglePopover } from "./popover.tsx"
import { idle, nextKeyState, type KeyState, type ShortcutAction } from "./shortcuts.ts"
import {
  accentColor,
  accentPickerOpen,
  documentMode,
  recentPages,
  remember,
  settingsDialogId,
  settingsTab,
  wideMode,
} from "./state.ts"

export const contentsItem = { _tag: "Page", name: "contents" } as const satisfies SidebarItem

export const helpMenuId = "seqno-help"

export const helpItem = { _tag: "Help" } as const satisfies SidebarItem

export const pageGraphItem = { _tag: "PageGraph" } as const satisfies SidebarItem

export const closeSidebarItem = (registry: AtomRegistry.AtomRegistry, item: SidebarItem) => {
  const { items } = registry.get(rightSidebar)
  registry.set(rightSidebar, items.length <= 1 ? { _tag: "Clear" } : { _tag: "Close", item })
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable], [role=menu], dialog") !== null)

const keyState = Atom.make<KeyState>(idle).pipe(Atom.keepAlive)

export const currentPageName = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter) => {
  const named = router.state.matches.flatMap((match) =>
    match.routeId === "/page/$name" ? [normalizePageName(match.params.name)] : [],
  )[0]
  if (named !== undefined) return named
  const home = router.state.matches.some((match) => match.routeId === "/")
  return home ? (registry.get(journals)[0]?.name ?? null) : null
}

const currentPage = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter) => {
  const name = currentPageName(registry, router)
  return registry.get(allPages).find((page) => page.name === name)
}

const goToJournal = (router: RegisteredRouter, date: Date) =>
  void router.navigate({
    to: "/page/$name",
    params: { name: normalizePageName(journalTitle(date)) },
  })

const shownDate = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter) =>
  journalDate(currentPageName(registry, router) ?? "") ?? new Date()

const toggleOpenBlocks = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter) => {
  const page = currentPage(registry, router)
  if (page === undefined) return
  const tree = registry.get(pageTreeAtom(page.id))
  if (!AsyncResult.isSuccess(tree)) return
  const blocks = tree.value.blocks
  const parents = new Set(blocks.map((block) => block.parentId))
  const folding = blocks.filter((block) => parents.has(block.id))
  const collapsed = folding.every((block) => !block.collapsed)
  const commands = folding.flatMap((block): ReadonlyArray<Command> =>
    block.collapsed === collapsed ? [] : [{ _tag: "SetCollapsed", blockId: block.id, collapsed }],
  )
  if (commands.length > 0) registry.set(dispatchAllAtom, commands)
}

const toggleSettings = () => {
  const dialog = document.getElementById(settingsDialogId)
  if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close()
  else openDialog(settingsDialogId)
}

export const perform = (
  registry: AtomRegistry.AtomRegistry,
  router: RegisteredRouter,
): Record<ShortcutAction, () => void> => ({
  ToggleTheme: () => registry.set(theme, registry.get(resolvedTheme) === "dark" ? "light" : "dark"),
  ToggleLeftSidebar: () => registry.set(leftSidebarOpen, !registry.get(leftSidebarOpen)),
  ToggleRightSidebar: () => registry.set(rightSidebar, { _tag: "Toggle" }),
  ToggleWideMode: () => registry.set(wideMode, !registry.get(wideMode)),
  ToggleDocumentMode: () => registry.set(documentMode, !registry.get(documentMode)),
  PickAccentColor: () => registry.set(accentPickerOpen, !registry.get(accentPickerOpen)),
  ResetAccentColor: () => registry.set(accentColor, "logseq"),
  ToggleBrackets: () => registry.set(toggleBrackets, undefined),
  ToggleHelp: () => togglePopover(helpMenuId),
  GoJournals: () => void router.navigate({ to: "/" }),
  GoHome: () => void router.navigate({ to: "/" }),
  GoAllPages: () => void router.navigate({ to: "/all-pages" }),
  GoGraphView: () => void router.navigate({ to: "/graph" }),
  GoWhiteboards: () => void router.navigate({ to: "/whiteboards" }),
  NewWhiteboard: () => {
    const name = crypto.randomUUID()
    const stop = registry.subscribe(createWhiteboard, (result) => {
      if (!AsyncResult.isSuccess(result) || result.value !== name) return
      stop()
      void router.navigate({ to: "/page/$name", params: { name } })
    })
    registry.set(createWhiteboard, name)
  },
  GoShortcuts: () => {
    registry.set(settingsTab, "keymap")
    openDialog(settingsDialogId)
  },
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
    const today = registry.get(journals).find((page) => page.journalDay === dayOf(new Date()))
    if (today !== undefined) {
      registry.set(rightSidebar, { _tag: "Open", item: { _tag: "Page", name: today.name } })
    }
  },
  ToggleSettings: () => {
    registry.set(settingsTab, "general")
    toggleSettings()
  },
  GoPlugins: openPlugins,
  SelectThemeColor: () => openPalette(registry, "themes"),
  SearchThemes: () => openPalette(registry, "themes"),
  GoBackward: () => router.history.back(),
  GoForward: () => router.history.forward(),
  ToggleFavorite: () => {
    const name = currentPageName(registry, router)
    if (name !== null) registry.set(toggleFavorite, name)
  },
  GoNextJournal: () => goToJournal(router, shiftDays(shownDate(registry, router), 1)),
  GoPrevJournal: () => goToJournal(router, shiftDays(shownDate(registry, router), -1)),
  GoTomorrow: () => goToJournal(router, shiftDays(new Date(), 1)),
  ToggleOpenBlocks: () => toggleOpenBlocks(registry, router),
  SelectGraph: () => registry.set(graphSelect, "open"),
  RebuildIndex: () => registry.set(rebuildIndex, undefined),
})

const recordVisit = (registry: AtomRegistry.AtomRegistry, router: RegisteredRouter) => {
  const opened = registry.get(openGraph)
  const visited = router.state.matches.flatMap((match) =>
    match.routeId === "/page/$name" && match.search.zoom === undefined ? [match.params.name] : [],
  )[0]
  if (!AsyncResult.isSuccess(opened) || visited === undefined) return
  const graph = opened.value.graph
  const all = registry.get(recentPages)
  const next = remember(all[graph] ?? [], normalizePageName(visited))
  if (next !== all[graph]) registry.set(recentPages, { ...all, [graph]: next })
}

const nothing = (): void => undefined

const mainColumn = () => document.querySelector<HTMLElement>(".main-content-container")

const keyOf = (location: ParsedLocation) => location.state.key ?? location.href

const atTop: Place = { offset: 0, anchor: null }

const scrollMemory = (router: RegisteredRouter) => {
  const places = new Map<string, Place>()
  let restored: string | null = null
  let stopHolding = nothing
  const stopSaving = router.subscribe("onBeforeLoad", ({ fromLocation }) => {
    const main = mainColumn()
    if (fromLocation !== undefined && main !== null) places.set(keyOf(fromLocation), placeOf(main))
  })
  const stopRestoring = router.subscribe("onRendered", ({ toLocation }) => {
    const key = keyOf(toLocation)
    if (key === restored) return
    restored = key
    stopHolding()
    const main = mainColumn()
    if (main !== null) stopHolding = restorePlace(main, places.get(key) ?? atTop)
  })
  return () => {
    stopSaving()
    stopRestoring()
    stopHolding()
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
      const step = historyStep(event)
      if (step !== null) {
        event.preventDefault()
        registry.set(historyAtom, step)
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
