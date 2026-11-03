import { logseq } from "@seqno/dom"
import { Option } from "effect"
import type { AtomRegistry } from "effect/reactivity"
import { applyStyle, injectStyle, injectUI, removeInjected, type UIOptions } from "./inject.ts"
import {
  call,
  channelOf,
  channels,
  decodeApiCall,
  decodeMessage,
  handshake,
  request,
  snakeCase,
} from "./protocol.ts"
import { entryOf, local } from "./files.ts"
import { record, settingItems, strings, text, themesOf } from "./package.ts"
import { makeDraggable, makeResizable, restoreLayout, type LayoutData } from "./layout.ts"
import {
  fencedRenderers,
  mainUILayout,
  pluginCommands,
  pluginSettings,
  running,
  runtimeThemes,
  settingsFor,
  slashCommands,
  uiItems,
  type PluginInfo,
  type PluginTheme,
  type Running,
  type Settings,
} from "./state.ts"

export type Api = (pid: string, method: string, args: ReadonlyArray<unknown>) => unknown

interface Loaded {
  readonly info: PluginInfo
  readonly frame: HTMLIFrameElement
  readonly container: HTMLDivElement
  readonly origin: string
  readonly hooks: Set<string>
  readonly requests: Map<number, (value: unknown) => void>
  connected: boolean
  restarted: boolean
  sdk: string | null
  nextUid: number
}

export type HookNamespace = "app" | "editor" | "db"

export interface Host {
  readonly load: (info: PluginInfo) => void
  readonly unload: (pid: string) => Promise<void>
  readonly loaded: (pid: string) => boolean
  readonly hook: (ns: HookNamespace, type: string, payload: unknown, pid?: string) => void
  readonly installHook: (pid: string, hook: string) => void
  readonly uninstallHook: (pid: string, hook: string) => void
  readonly wants: (hook: string) => boolean
  readonly setSdk: (pid: string, version: string) => void
  readonly callModel: (pid: string, name: string, data: unknown) => void
  readonly requestModel: (
    pid: string,
    name: string,
    args: ReadonlyArray<unknown>,
  ) => Promise<unknown>
  readonly saveSettings: (pid: string, settings: Settings) => void
  readonly showMainUI: (pid: string, visible: boolean, autoFocus: boolean) => void
  readonly dispose: () => void
}

const uiOptions = (payload: unknown): UIOptions => {
  const ui = record(payload)
  return {
    key: text(ui["key"]),
    slot: text(ui["slot"]),
    path: text(ui["path"]),
    template: text(ui["template"]),
    style: strings(ui["style"]),
    attrs: strings(ui["attrs"]),
    reset: ui["reset"] === true,
    close: text(ui["close"]),
  }
}

const isRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const merge = (base: Settings, patch: Readonly<Record<string, unknown>>): Settings => {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const before = merged[key]
    merged[key] = isRecord(value) && isRecord(before) ? merge(record(before), record(value)) : value
  }
  return merged
}

const without = <A extends { readonly pid: string }>(items: ReadonlyArray<A>, pid: string) =>
  items.filter((item) => item.pid !== pid)

const placeKeys = new Set(["left", "top", "bottom", "right", "width", "height"])

const handshakeTries = 40
const handshakeEvery = 250
const requestTimeout = 10_000

const idle: Running = { status: { _tag: "Loading" }, schema: [], mainUI: false }

export const createHost = (
  registry: AtomRegistry.AtomRegistry,
  makeApi: (host: Host) => Api,
): Host => {
  const plugins = new Map<string, Loaded>()

  const setRunning = (pid: string, update: (current: Running) => Running) => {
    const all = registry.get(running)
    registry.set(running, { ...all, [pid]: update(all[pid] ?? idle) })
  }

  const post = (plugin: Loaded, message: unknown) =>
    plugin.frame.contentWindow?.postMessage(message, plugin.origin)

  const settingsOf = (pid: string) => registry.get(pluginSettings(pid))

  const saveSettings = (pid: string, settings: Settings) => {
    registry.set(pluginSettings(pid), settings)
    const plugin = plugins.get(pid)
    if (plugin?.connected === true) post(plugin, call(channels.settings, { payload: settings }))
  }

  const showMainUI = (pid: string, visible: boolean, autoFocus: boolean) => {
    const plugin = plugins.get(pid)
    if (plugin === undefined) return
    plugin.container.className = logseq("seqno-plugin-frames", visible).className
    plugin.container.toggleAttribute("data-visible", visible)
    setRunning(pid, (current) => ({ ...current, mainUI: visible }))
    if (visible && autoFocus) plugin.frame.focus()
    if (!visible && document.activeElement === plugin.frame) plugin.frame.blur()
  }

  const requestModel = (pid: string, name: string, args: ReadonlyArray<unknown>) => {
    const plugin = plugins.get(pid)
    if (plugin === undefined) return Promise.resolve(undefined)
    plugin.nextUid += 1
    const uid = plugin.nextUid
    return new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        plugin.requests.delete(uid)
        resolve(undefined)
      }, requestTimeout)
      plugin.requests.set(uid, (value) => {
        clearTimeout(timer)
        resolve(value)
      })
      post(plugin, request(name, args, uid))
    })
  }

  const hook = (ns: HookNamespace, type: string, payload: unknown, pid?: string) => {
    const name = `hook:${ns}:${snakeCase(type)}`
    const message = call(channels.hook, { ns: `hook:${ns}`, type: snakeCase(type), payload })
    for (const plugin of plugins.values()) {
      if (!plugin.connected) continue
      const wanted =
        pid !== undefined
          ? plugin.info.id === pid
          : plugin.sdk === null
            ? ns !== "db"
            : plugin.hooks.has(name)
      if (wanted) post(plugin, message)
    }
  }

  const addThemes = (themes: ReadonlyArray<PluginTheme>) => {
    if (themes.length === 0) return
    const known = registry.get(runtimeThemes)
    const fresh = themes.filter(
      (theme) => !known.some((other) => other.pid === theme.pid && other.url === theme.url),
    )
    registry.set(runtimeThemes, [...known, ...fresh])
  }

  const host: Host = {
    load: (info) => load(info),
    unload: (pid) => unload(pid),
    loaded: (pid) => plugins.get(pid)?.connected === true,
    hook,
    installHook: (pid, name) => void plugins.get(pid)?.hooks.add(name),
    uninstallHook: (pid, name) => void plugins.get(pid)?.hooks.delete(name),
    wants: (name) =>
      [...plugins.values()].some(
        (plugin) => plugin.hooks.has(name) || (plugin.sdk === null && !name.startsWith("hook:db")),
      ),
    setSdk: (pid, version) => {
      const plugin = plugins.get(pid)
      if (plugin !== undefined) plugin.sdk = version
    },
    callModel: (pid, name, data) => {
      const plugin = plugins.get(pid)
      if (plugin !== undefined) post(plugin, call(name, data))
    },
    requestModel,
    saveSettings,
    showMainUI,
    dispose: () => window.removeEventListener("message", onMessage),
  }

  const api = makeApi(host)

  const answer = (plugin: Loaded, payload: unknown) =>
    Option.match(decodeApiCall(payload), {
      onNone: () => undefined,
      onSome: async ({ method, args, _sync }) => {
        const result = await Promise.resolve()
          .then(() => api(plugin.info.id, method, args ?? []))
          .catch((error: unknown) => ({
            [channels.error]: error instanceof Error ? error.message : String(error),
          }))
        if (_sync !== undefined) {
          post(plugin, call(channels.reply, { _sync, result: result ?? null }))
        }
      },
    })

  const onSchema = (pid: string, payload: unknown) => {
    const { schema, isSync } = record(payload)
    const items = settingItems(schema)
    setRunning(pid, (current) => ({ ...current, schema: items }))
    if (isSync !== true) return
    const stored = settingsOf(pid)
    const missing = items.filter((item) => item.type !== "heading" && !(item.key in stored))
    saveSettings(pid, {
      ...Object.fromEntries(missing.map((item) => [item.key, item.default])),
      ...stored,
    })
    const plugin = plugins.get(pid)
    if (missing.length > 0 && plugin !== undefined && !plugin.restarted) {
      void unload(pid).then(() => load(plugin.info, true))
    }
  }

  const onEmit = (plugin: Loaded, type: string, payload: unknown) => {
    const pid = plugin.info.id
    switch (type) {
      case "api:call":
        return void answer(plugin, payload)
      case "provider:ui":
        return injectUI(pid, uiOptions(payload), (name, event) => post(plugin, call(name, event)))
      case "provider:style": {
        const style = typeof payload === "string" ? { key: null, style: payload } : record(payload)
        return injectStyle(pid, text(style["key"]), text(style["style"]) ?? "")
      }
      case "provider:theme":
        return addThemes(themesOf(pid, plugin.info.root, [payload]))
      case "settings:schema":
        return onSchema(pid, payload)
      case "settings:update":
        return saveSettings(pid, merge(settingsOf(pid), record(payload)))
      case "settings:visible:changed":
        return record(payload)["visible"] === true ? registry.set(settingsFor, pid) : undefined
      case "main-ui:visible": {
        const options = record(payload)
        return showMainUI(pid, options["visible"] === true, options["autoFocus"] !== false)
      }
      case "main-ui:style": {
        const style = record(payload)
        const placed = plugin.container.dataset["inited_layout"] !== undefined
        return applyStyle(
          plugin.container,
          placed
            ? Object.fromEntries(Object.entries(style).filter(([key]) => !placeKeys.has(key)))
            : style,
        )
      }
      case "main-ui:attrs": {
        const save = (layout: LayoutData) => registry.set(mainUILayout(pid), layout)
        for (const [key, value] of Object.entries(record(payload))) {
          plugin.container.setAttribute(key, String(value))
          if (key === "draggable" && value === true) {
            makeDraggable(plugin.container, {
              title: plugin.info.title,
              close: () => post(plugin, call("sys:ui:visible", { toggle: true })),
              saved: save,
            })
          }
          if (key === "resizable" && value === true) makeResizable(plugin.container, save)
        }
        return
      }
      default:
        return
    }
  }

  const connect = (plugin: Loaded) => {
    plugin.connected = true
    setRunning(plugin.info.id, (current) => ({ ...current, status: { _tag: "Ready" } }))
    post(plugin, call(channels.ready, { pid: plugin.info.id }))
  }

  const onMessage = (event: MessageEvent) => {
    const plugin = [...plugins.values()].find((one) => one.frame.contentWindow === event.source)
    if (plugin === undefined || event.origin !== plugin.origin) return
    Option.match(decodeMessage(event.data), {
      onNone: () => undefined,
      onSome: (message) => {
        switch (message.postmate) {
          case "handshake-reply":
            return plugin.connected ? undefined : connect(plugin)
          case "reply": {
            const resolve = plugin.requests.get(message.uid)
            plugin.requests.delete(message.uid)
            return resolve?.(message.value)
          }
          case "emit":
            return message.value.name === channelOf(plugin.info.id)
              ? onEmit(plugin, message.value.data.type, message.value.data.payload)
              : undefined
        }
      },
    })
  }

  window.addEventListener("message", onMessage)

  const baseInfo = (info: PluginInfo) => ({
    ...info.package,
    id: info.id,
    title: info.title,
    version: info.version,
    settings: settingsOf(info.id),
    lsr: local(info.root),
    webMode: "github",
    iir: false,
    usf: null,
    err: null,
  })

  const fail = (pid: string, reason: string) =>
    setRunning(pid, (current) => ({ ...current, status: { _tag: "Failed", reason } }))

  const shake = (plugin: Loaded) => {
    let tries = 0
    const send = () => post(plugin, handshake(baseInfo(plugin.info)))
    const timer = setInterval(() => {
      tries += 1
      const live = plugins.get(plugin.info.id) === plugin
      if (plugin.connected || !live || tries > handshakeTries) {
        clearInterval(timer)
        if (!plugin.connected && live) fail(plugin.info.id, "It didn't answer when it loaded.")
        return
      }
      send()
    }, handshakeEvery)
    send()
  }

  const load = (info: PluginInfo, restarted = false) => {
    if (plugins.has(info.id)) return
    addThemes(info.themes)
    const main = entryOf(info)
    if (main === null || settingsOf(info.id)["disabled"] === true) return
    const entry = new URL(main)
    entry.searchParams.set("__v__", info.version)
    const container = document.createElement("div")
    container.id = `${info.id}_lsp_main`
    container.className = logseq("seqno-plugin-frames", false).className
    container.dataset["pid"] = info.id
    const layout = registry.get(mainUILayout(info.id))
    if (layout !== null) restoreLayout(container, layout)
    const frame = document.createElement("iframe")
    frame.id = `${info.id}_iframe`
    frame.className = logseq("seqno-plugin-frame").className
    frame.title = info.title
    const plugin: Loaded = {
      info,
      frame,
      container,
      origin: entry.origin,
      hooks: new Set(),
      requests: new Map(),
      connected: false,
      restarted,
      sdk: null,
      nextUid: 0,
    }
    plugins.set(info.id, plugin)
    setRunning(info.id, () => idle)
    frame.addEventListener("load", () => shake(plugin), { once: true })
    frame.addEventListener("error", () => fail(info.id, "Its files didn't load."), { once: true })
    frame.src = entry.href
    container.append(frame)
    document.body.append(container)
  }

  const unload = async (pid: string) => {
    const plugin = plugins.get(pid)
    if (plugin?.connected === true) {
      await Promise.race([
        requestModel(pid, channels.beforeUnload, [{ unregister: true }]),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ])
    }
    plugin?.container.remove()
    plugins.delete(pid)
    removeInjected(pid)
    registry.set(uiItems, without(registry.get(uiItems), pid))
    registry.set(slashCommands, without(registry.get(slashCommands), pid))
    registry.set(pluginCommands, without(registry.get(pluginCommands), pid))
    registry.set(runtimeThemes, without(registry.get(runtimeThemes), pid))
    registry.set(fencedRenderers, without(registry.get(fencedRenderers), pid))
    registry.set(
      running,
      Object.fromEntries(Object.entries(registry.get(running)).filter(([key]) => key !== pid)),
    )
  }

  return host
}
