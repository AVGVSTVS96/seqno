import { IconPuzzle } from "@tabler/icons-react"
import { Atom, type AtomRegistry } from "effect/reactivity"
import type { BlockId, GraphEvent } from "@seqno/domain"
import { editingBlock, type SlashCommand } from "@seqno/editor"
import { createApi, lastCursor, type Bridge } from "./api.ts"
import { dropCopy, ensureCopy, keepCopy } from "./files.ts"
import { createHost, type Host } from "./host.ts"
import { fetchPlugin, type MarketItem } from "./marketplace.ts"
import { watchSelection } from "./selection.ts"
import { record, text } from "./package.ts"
import { changedBlock } from "./shapes.ts"
import {
  installedPlugins,
  pluginCommands,
  pluginSettings,
  type PluginCommand,
  type PluginSlashCommand,
} from "./state.ts"

export const hostAtom = Atom.make<Host | null>(null).pipe(Atom.keepAlive)

const onMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

const comboMatches = (combo: string, event: KeyboardEvent) => {
  const parts = combo.toLowerCase().split("+")
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

const shortcutOf = (command: PluginCommand) => {
  const binding = command.keybinding
  if (binding === null) return []
  return onMac && binding.mac.length > 0 ? binding.mac : binding.binding
}

export const runCommand = (host: Host, command: PluginCommand, uuid: BlockId | null) =>
  host.hook("editor", command.eventKey, uuid === null ? {} : { uuid }, command.pid)

export interface HighlightPayload {
  readonly text: string
  readonly x: number
  readonly y: number
}

export const runHighlightItem = (host: Host, command: PluginCommand, highlight: HighlightPayload) =>
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

const insertAtCaret = (insert: string, backward: number) => {
  const live = editingBlock()
  if (live === null) return
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
  commands: ReadonlyArray<PluginSlashCommand>,
  blockId: BlockId,
): ReadonlyArray<SlashCommand> =>
  host === null
    ? []
    : commands.map((command) => ({
        label: command.label,
        group: "PLUGINS",
        icon: IconPuzzle,
        apply: (draft) => ({
          draft: { text: draft.text, from: draft.from, to: draft.from },
          after: () => runSlash(host, command, blockId),
        }),
      }))

export const startPlugins = (registry: AtomRegistry.AtomRegistry, bridge: Bridge) => {
  const host = createHost(registry, createApi(registry, bridge))
  registry.set(hostAtom, host)
  for (const info of registry.get(installedPlugins)) {
    host.load(info)
    void ensureCopy(info).catch(() => undefined)
  }
  watchSelection(host)

  window.addEventListener(
    "keydown",
    (event) => {
      const editing = editingBlock() !== null
      for (const command of registry.get(pluginCommands)) {
        const mode = command.keybinding?.mode ?? "global"
        if ((mode === "editing" && !editing) || (mode === "non-editing" && editing)) continue
        if (shortcutOf(command).some((combo) => comboMatches(combo, event))) {
          event.preventDefault()
          runCommand(host, command, editingBlock()?.blockId ?? null)
          return
        }
      }
    },
    true,
  )
  return host
}

export const changedPayload = (events: ReadonlyArray<GraphEvent>) => ({
  blocks: events.flatMap((event) =>
    event._tag === "BlockUpserted" ? [changedBlock(event.block)] : [],
  ),
  txData: [],
  txMeta: { outlinerOp: "save-block" },
})

export const install = async (registry: AtomRegistry.AtomRegistry, item: MarketItem) => {
  const info = await fetchPlugin(item)
  await keepCopy(info)
  const before = registry.get(installedPlugins).find((other) => other.id === info.id)
  if (before !== undefined && before.root !== info.root) void dropCopy(before)
  registry.set(installedPlugins, [
    ...registry.get(installedPlugins).filter((other) => other.id !== info.id),
    info,
  ])
  registry.get(hostAtom)?.load(info)
  return info
}

export const uninstall = async (registry: AtomRegistry.AtomRegistry, pid: string) => {
  await registry.get(hostAtom)?.unload(pid)
  const info = registry.get(installedPlugins).find((other) => other.id === pid)
  if (info !== undefined) await dropCopy(info)
  registry.set(
    installedPlugins,
    registry.get(installedPlugins).filter((other) => other.id !== pid),
  )
  registry.set(pluginSettings(pid), { disabled: false })
}

export const setEnabled = async (
  registry: AtomRegistry.AtomRegistry,
  pid: string,
  enabled: boolean,
) => {
  const host = registry.get(hostAtom)
  registry.set(pluginSettings(pid), { ...registry.get(pluginSettings(pid)), disabled: !enabled })
  if (!enabled) return host?.unload(pid)
  const info = registry.get(installedPlugins).find((one) => one.id === pid)
  if (info !== undefined) host?.load(info)
}

export const macroArguments = (args: string) =>
  args
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
