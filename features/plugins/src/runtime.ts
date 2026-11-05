import { IconPuzzle } from "@tabler/icons-react"
import { Atom } from "effect/reactivity"
import type { AtomRegistry } from "effect/reactivity"
import type { BlockId, GraphEvent } from "@seqno/domain"
import { editingBlock } from "@seqno/editor"
import type { SlashCommand } from "@seqno/editor"
import { createApi, lastCursor } from "./api.ts"
import type { Bridge } from "./api.ts"
import { dropCopy, ensureCopy, keepCopy } from "./files.ts"
import { openHostScope } from "./experiments.ts"
import { createHost } from "./host.ts"
import type { Host } from "./host.ts"
import { fetchPlugin } from "./marketplace.ts"
import type { MarketItem } from "./marketplace.ts"
import { watchSelection } from "./selection.ts"
import { record, text } from "./package.ts"
import { changedBlock } from "./shapes.ts"
import {
  chosenThemes,
  installedPlugins,
  pluginCommands,
  pluginSettings,
  updatesComing,
} from "./state.ts"
import type { ChosenTheme, PluginCommand, PluginInfo, PluginSlashCommand } from "./state.ts"

export const hostAtom = Atom.make<Host | null>(null).pipe(Atom.keepAlive)

const onMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform)

const stepMatches = (step: string, event: KeyboardEvent) => {
  const parts = step.toLowerCase().split("+")
  const key = parts.at(-1) ?? ""
  const has = (name: string) => parts.includes(name)
  const mod = has("mod")

  return (
    event.key.toLowerCase() === key &&
    event.shiftKey === has("shift") &&
    event.altKey === has("alt") &&
    event.metaKey === (has("meta") || (mod && onMac)) &&
    event.ctrlKey === (has("ctrl") || (mod && !onMac))
  )
}

const comboMatches = (combo: string, event: KeyboardEvent, previous: KeyboardEvent | null) => {
  const steps = combo.trim().split(/\s+/u)
  const last = steps.at(-1) ?? ""

  if (steps.length === 1) {
    return stepMatches(last, event)
  }

  const first = steps[0] ?? ""

  return previous !== null && stepMatches(first, previous) && stepMatches(last, event)
}

const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta"])

const modified = (combo: string) => /(^|[+ ])(mod|ctrl|meta|alt)\+/iu.test(combo)

const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select") !== null)

const shortcutOf = (command: PluginCommand) => {
  const binding = command.keybinding

  if (binding === null) {
    return []
  }

  return onMac && binding.mac.length > 0 ? binding.mac : binding.binding
}

export const runCommand = (host: Host, command: PluginCommand, uuid: BlockId | null) => {
  host.hook("editor", command.eventKey, uuid === null ? {} : { uuid }, command.pid)
}

export interface HighlightPayload {
  readonly text: string
  readonly x: number
  readonly y: number
}

export const runHighlightItem = (
  host: Host,
  command: PluginCommand,
  highlight: HighlightPayload,
) => {
  host.hook(
    "editor",
    command.eventKey,
    {
      key: command.key,
      content: { text: highlight.text },
      point: { x: highlight.x, y: highlight.y },
      format: null,
      uuid: editingBlock()?.blockId ?? null,
    },
    command.pid,
  )
}

export const runPageCommand = (host: Host, command: PluginCommand, page: string) => {
  host.hook("editor", command.eventKey, { page }, command.pid)
}

const insertAtCaret = (insert: string, backward: number) => {
  const live = editingBlock()

  if (live === null) {
    return
  }

  const { from, to } = live.view.state.selection.main
  live.view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - backward },
    userEvent: "input",
  })
}

const runSlash = (host: Host, command: PluginSlashCommand, blockId: BlockId) => {
  const live = editingBlock()
  lastCursor.current = { blockId, caret: live?.view.state.selection.main.head ?? 0 }

  for (const action of command.actions) {
    const [name, first, second] = action

    if (name === "editor/input") {
      const backward = record(second)["backward-pos"]
      insertAtCaret(text(first) ?? "", typeof backward === "number" ? backward : 0)
    }

    if (name === "editor/hook") {
      host.hook("editor", text(first) ?? "", { uuid: blockId }, command.pid)
    }
  }
}

export const editorCommands = (
  host: Host | null,
  commands: readonly PluginSlashCommand[],
  blockId: BlockId,
): readonly SlashCommand[] =>
  host === null
    ? []
    : commands.map((command) => ({
        label: command.label,
        group: "PLUGINS",
        icon: IconPuzzle,
        apply: (draft) => ({
          draft: { text: draft.text, from: draft.from, to: draft.from },
          after: () => {
            runSlash(host, command, blockId)
          },
        }),
      }))

const loadPlugin = async (registry: AtomRegistry.AtomRegistry, info: PluginInfo) => {
  const host = registry.get(hostAtom)

  if (host === null) {
    return
  }

  await openHostScope(registry, host)
  host.load(info)
}

export const startPlugins = (registry: AtomRegistry.AtomRegistry, bridge: Bridge) => {
  const host = createHost(registry, createApi(registry, bridge))
  registry.set(hostAtom, host)

  for (const info of registry.get(installedPlugins)) {
    void loadPlugin(registry, info)
    void ensureCopy(info).catch(() => undefined)
  }

  watchSelection(host)

  let previous: KeyboardEvent | null = null
  window.addEventListener(
    "keydown",
    (event) => {
      const editing = editingBlock() !== null
      const typing = !editing && typingIn(event.target)

      if (modifierKeys.has(event.key)) {
        return
      }

      const before = previous
      previous = event

      for (const command of registry.get(pluginCommands)) {
        const mode = command.keybinding?.mode ?? "global"

        if ((mode === "editing" && !editing) || (mode === "non-editing" && editing)) {
          continue
        }

        const bound = shortcutOf(command).filter((combo) => !typing || modified(combo))

        if (bound.some((combo) => comboMatches(combo, event, before))) {
          event.preventDefault()
          previous = null
          runCommand(host, command, editingBlock()?.blockId ?? null)

          return
        }
      }
    },
    true,
  )

  return host
}

export const changedPayload = (events: readonly GraphEvent[]) => ({
  blocks: events.flatMap((event) =>
    event._tag === "BlockUpserted" ? [changedBlock(event.block)] : [],
  ),
  txData: [],
  txMeta: { outlinerOp: "save-block" },
})

const movedThemes = (
  registry: AtomRegistry.AtomRegistry,
  before: PluginInfo,
  after: PluginInfo,
) => {
  const move = (pick: ChosenTheme | null) => {
    if (pick === null || pick.pid !== after.id) {
      return pick
    }

    const at = before.themes.findIndex((theme) => theme.url === pick.url)

    const theme =
      after.themes[at] ?? after.themes.find((one) => one.name === before.themes[at]?.name)

    return theme === undefined ? pick : { pid: after.id, url: theme.url }
  }

  const chosen = registry.get(chosenThemes)
  registry.set(chosenThemes, { light: move(chosen.light), dark: move(chosen.dark) })
}

export const replacePlugin = async (registry: AtomRegistry.AtomRegistry, info: PluginInfo) => {
  await keepCopy(info)
  const installed = registry.get(installedPlugins)
  const before = installed.find((other) => other.id === info.id)

  if (before !== undefined) {
    await registry.get(hostAtom)?.unload(info.id)
  }

  registry.set(
    installedPlugins,
    before === undefined
      ? [...installed, info]
      : installed.map((other) => (other.id === info.id ? info : other)),
  )

  if (before !== undefined) {
    movedThemes(registry, before, info)
  }

  await loadPlugin(registry, info)

  if (before !== undefined && before.root !== info.root) {
    await dropCopy(before)
  }
}

export const install = async (registry: AtomRegistry.AtomRegistry, item: MarketItem) => {
  const info = await fetchPlugin(item)
  await replacePlugin(registry, info)

  return info
}

export const uninstall = async (registry: AtomRegistry.AtomRegistry, pid: string) => {
  await registry.get(hostAtom)?.unload(pid)
  const info = registry.get(installedPlugins).find((other) => other.id === pid)

  if (info !== undefined) {
    await dropCopy(info)
  }

  registry.set(
    installedPlugins,
    registry.get(installedPlugins).filter((other) => other.id !== pid),
  )
  registry.set(pluginSettings(pid), { disabled: false })
  registry.set(
    updatesComing,
    registry.get(updatesComing).filter((coming) => coming.pid !== pid),
  )
}

export const setEnabled = async (
  registry: AtomRegistry.AtomRegistry,
  pid: string,
  enabled: boolean,
) => {
  const host = registry.get(hostAtom)
  registry.set(pluginSettings(pid), { ...registry.get(pluginSettings(pid)), disabled: !enabled })

  if (!enabled) {
    return await host?.unload(pid)
  }

  const info = registry.get(installedPlugins).find((one) => one.id === pid)

  if (info !== undefined) {
    await loadPlugin(registry, info)
  }
}

export const macroArguments = (args: string) =>
  args
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
