import type { RegisteredRouter } from "@tanstack/react-router"
import { Schema } from "effect"
import type { AtomRegistry } from "effect/reactivity"
import { historyAtom } from "@seqno/outliner"
import { hostAtom, runCommand, type PluginCommand } from "@seqno/plugins"
import { rightSidebar } from "../../atoms.ts"
import { openPalette } from "../search/atoms.ts"
import type { PaletteCommand } from "../search/model.ts"
import { perform } from "./listeners.ts"
import { notices } from "./Notices.tsx"
import { keysOf, onMac, type ShortcutAction } from "./shortcuts.ts"
import { setting } from "./state.ts"

export interface RunnableCommand extends PaletteCommand {
  readonly run: (returnTo: HTMLElement | null) => void
}

export const commandHistory = setting(
  "seqno.commandHistory",
  Schema.Record(Schema.String, Schema.Finite),
  {},
)

const keyNames: Readonly<Record<string, string>> = {
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  escape: "Escape",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
}

const replayed = (combo: string) => {
  const parts = combo.split(" ")
  const key = parts.at(-1) ?? ""
  const mod = parts.includes("mod")
  return new KeyboardEvent("keydown", {
    key: keyNames[key] ?? key,
    bubbles: true,
    cancelable: true,
    shiftKey: parts.includes("shift"),
    altKey: parts.includes("alt"),
    metaKey: mod && onMac,
    ctrlKey: mod && !onMac,
  })
}

const replay = (id: string, label: string, ...combos: ReadonlyArray<string>): RunnableCommand => ({
  id,
  label,
  keys: combos.map((combo) => combo.split(" ")),
  run: (returnTo) => {
    const first = combos[0]
    if (returnTo === null || first === undefined) return
    returnTo.focus()
    returnTo.dispatchEvent(replayed(first))
  },
})

const plain = (
  id: string,
  label: string,
  run: () => void,
  ...keys: ReadonlyArray<string>
): RunnableCommand => ({
  id,
  label,
  keys: keys.map((combo) => combo.split(" ")),
  run,
})

const moveChord = onMac ? "mod shift" : "alt shift"

const pluginKeys = (command: PluginCommand): ReadonlyArray<ReadonlyArray<string>> => {
  const binding = command.keybinding
  if (binding === null) return []
  const combos = onMac && binding.mac.length > 0 ? binding.mac : binding.binding
  return combos.map((combo) => {
    const steps = combo.trim().split(/\s+/)
    return steps.every((step) => !step.includes("+"))
      ? steps
      : steps.flatMap((step, at) => [...(at === 0 ? [] : ["then"]), ...step.split("+")])
  })
}

export const pluginPaletteCommands = (
  registry: AtomRegistry.AtomRegistry,
  commands: ReadonlyArray<PluginCommand>,
): ReadonlyArray<RunnableCommand> =>
  commands
    .filter((command) => command.palette)
    .map((command) => ({
      id: `plugin.${command.pid}/${command.key}`,
      label: command.label,
      keys: pluginKeys(command),
      run: () => {
        const host = registry.get(hostAtom)
        if (host !== null) runCommand(host, command, null)
      },
    }))

export const builtInCommands = (
  registry: AtomRegistry.AtomRegistry,
  router: RegisteredRouter,
): ReadonlyArray<RunnableCommand> => {
  const actions = perform(registry, router)
  const app = (id: string, label: string, action: ShortcutAction): RunnableCommand => ({
    id,
    label,
    keys: [keysOf(action)],
    run: actions[action],
  })
  return [
    app("ui/toggle-wide-mode", "Toggle wide mode", "ToggleWideMode"),
    app("ui/toggle-theme", "Toggle between dark/light theme", "ToggleTheme"),
    app("ui/toggle-settings", "Toggle settings", "ToggleSettings"),
    app("ui/toggle-right-sidebar", "Toggle right sidebar", "ToggleRightSidebar"),
    app("ui/toggle-left-sidebar", "Toggle left sidebar", "ToggleLeftSidebar"),
    app("ui/toggle-help", "Toggle help", "ToggleHelp"),
    app("ui/toggle-contents", "Toggle Contents in sidebar", "ToggleContents"),
    app("ui/select-theme-color", "Select available theme colors", "SelectThemeColor"),
    app("ui/goto-plugins", "Go to plugins dashboard", "GoPlugins"),
    plain("ui/clear-all-notifications", "Clear all notifications", () => registry.set(notices, [])),
    app("sidebar/open-today-page", "Open today's page in the right sidebar", "OpenTodayInSidebar"),
    app("sidebar/close-top", "Closes the top item in the right sidebar", "CloseTopSidebarItem"),
    plain("sidebar/clear", "Clear all in the right sidebar", () =>
      registry.set(rightSidebar, { _tag: "Clear" }),
    ),
    app("command/toggle-favorite", "Add to/remove from favorites", "ToggleFavorite"),
    app("go/search-themes", "Search themes", "SearchThemes"),
    plain(
      "go/search-in-page",
      "Search blocks in page",
      () => openPalette(registry, "current-page"),
      "mod shift k",
    ),
    plain("go/search", "Search pages and blocks", () => openPalette(registry, null), "mod k"),
    plain(
      "command-palette/toggle",
      "Search commands",
      () => openPalette(registry, "commands"),
      "mod shift p",
    ),
    app("go/keyboard-shortcuts", "Go to keyboard shortcuts", "GoShortcuts"),
    app("go/journals", "Go to journals", "GoJournals"),
    app("go/home", "Go to home", "GoHome"),
    app("go/graph-view", "Go to graph view", "GoGraphView"),
    app("go/forward", "Forwards", "GoForward"),
    app("go/backward", "Backwards", "GoBackward"),
    app("go/all-pages", "Go to all pages", "GoAllPages"),
    plain("go/all-graphs", "Go to all graphs", () => void router.navigate({ to: "/graphs" })),
    app("go/whiteboards", "Go to whiteboards", "GoWhiteboards"),
    app("editor/new-whiteboard", "New whiteboard", "NewWhiteboard"),
    plain("editor/undo", "Undo", () => registry.set(historyAtom, "Undo"), "mod z"),
    plain("editor/redo", "Redo", () => registry.set(historyAtom, "Redo"), "mod shift z", "mod y"),
    replay("editor/up", "Move cursor up / Select up", "arrowup"),
    replay("editor/down", "Move cursor down / Select down", "arrowdown"),
    replay("editor/select-up", "Select content above", "shift arrowup"),
    replay("editor/select-down", "Select content below", "shift arrowdown"),
    replay("editor/select-parent", "Select parent block", "mod a"),
    replay("editor/select-all-blocks", "Select all blocks", "mod shift a"),
    replay("editor/open-edit", "Edit selected block", "enter"),
    replay(
      "editor/open-selected-blocks-in-sidebar",
      "Open selected block(s) in sidebar",
      "shift enter",
    ),
    replay("editor/move-block-up", "Move block up", `${moveChord} arrowup`),
    replay("editor/move-block-down", "Move block down", `${moveChord} arrowdown`),
    replay("editor/indent", "Indent block", "tab"),
    replay("editor/outdent", "Outdent block", "shift tab"),
    replay("editor/expand-block-children", "Expand", "mod arrowdown"),
    replay("editor/collapse-block-children", "Collapse", "mod arrowup"),
    replay("editor/delete-selection", "Delete selected blocks", "backspace", "delete"),
    replay("editor/cycle-todo", "Rotate the TODO state", "mod enter"),
    replay("editor/cut", "Cut", "mod x"),
    replay("editor/copy", "Copy (copies either selection, or block reference)", "mod c"),
  ]
}

export const byUse = (
  commands: ReadonlyArray<RunnableCommand>,
  history: Readonly<Record<string, number>>,
) =>
  commands.toSorted(
    (left, right) =>
      (history[right.id] ?? 0) - (history[left.id] ?? 0) ||
      (left.id < right.id ? 1 : left.id > right.id ? -1 : 0),
  )

export const used = (registry: AtomRegistry.AtomRegistry, id: string) => {
  const history = registry.get(commandHistory)
  registry.set(commandHistory, { ...history, [id]: (history[id] ?? 0) + 1 })
}
