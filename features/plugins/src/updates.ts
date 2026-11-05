import { BrowserKeyValueStore } from "@effect/platform-browser"
import { Schema } from "effect"
import { Atom } from "effect/reactivity"
import type { AtomRegistry } from "effect/reactivity"
import { fetchPlugin } from "./marketplace.ts"
import { replacePlugin } from "./runtime.ts"
import { installedPlugins, pluginSettings, updatesComing } from "./state.ts"
import type { PluginInfo } from "./state.ts"

export interface Checking {
  readonly auto: boolean
  readonly left: readonly PluginInfo[]
  readonly current: string | null
}

export type Checked =
  | { readonly _tag: "Newer"; readonly version: string }
  | { readonly _tag: "Current" }
  | { readonly _tag: "Failed"; readonly reason: string }

export type Updated =
  | { readonly _tag: "Updated"; readonly title: string; readonly version: string }
  | { readonly _tag: "Failed"; readonly pid: string; readonly reason: string }

export const updatesChecking = Atom.make<Checking | null>(null).pipe(Atom.keepAlive)

export const updatesDownloading = Atom.make(false).pipe(Atom.keepAlive)

export const pluginBusy = Atom.make<string | null>(null).pipe(Atom.keepAlive)

export const updatesUnchecked = Atom.make<readonly string[]>([]).pipe(Atom.keepAlive)

export const lastAutoCheck = Atom.kvs({
  runtime: Atom.runtime(BrowserKeyValueStore.layerLocalStorage),
  key: "seqno.plugins.lastAutoUpdates",
  schema: Schema.Union([Schema.Boolean, Schema.Number]),
  defaultValue: (): boolean | number => true,
}).pipe(Atom.keepAlive)

const autoEvery = 12 * 60 * 60 * 1000

export const autoCheckDue = (last: boolean | number, now: number) =>
  last !== false && (last === true || now - last > autoEvery)

const numbers = (version: string) =>
  (/\d+(?:\.\d+){0,2}/.exec(version)?.[0] ?? "0").split(".").map(Number)

export const isNewer = (latest: string, current: string) => {
  const [a = 0, b = 0, c = 0] = numbers(latest)
  const [x = 0, y = 0, z = 0] = numbers(current)

  return a === x ? (b === y ? c > z : b > y) : a > x
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const enabledPlugins = (registry: AtomRegistry.AtomRegistry, themes: boolean | null) =>
  registry
    .get(installedPlugins)
    .filter(
      (info) =>
        info.repo !== null &&
        registry.get(pluginSettings(info.id))["disabled"] !== true &&
        (themes === null || themes === info.themes.length > 0),
    )

const withoutComing = (registry: AtomRegistry.AtomRegistry, pid: string) => {
  registry.set(
    updatesComing,
    registry.get(updatesComing).filter((coming) => coming.pid !== pid),
  )
}

const lookUp = async (registry: AtomRegistry.AtomRegistry, info: PluginInfo): Promise<Checked> => {
  if (info.repo === null) {
    return { _tag: "Failed", reason: "It has no marketplace repo." }
  }

  try {
    const latest = await fetchPlugin({ ...info, repo: info.repo })

    if (!isNewer(latest.version, info.version)) {
      withoutComing(registry, info.id)

      return { _tag: "Current" }
    }

    const coming = {
      pid: info.id,
      title: info.title,
      version: info.version,
      latest,
      failed: null,
    }

    const others = registry.get(updatesComing).filter((one) => one.pid !== info.id)
    registry.set(updatesComing, [...others, coming])

    return { _tag: "Newer", version: latest.version }
  } catch (error) {
    return { _tag: "Failed", reason: reasonOf(error) }
  }
}

export const checkUpdate = async (
  registry: AtomRegistry.AtomRegistry,
  pid: string,
): Promise<Checked | null> => {
  const info = registry.get(installedPlugins).find((one) => one.id === pid)

  if (info === undefined || registry.get(pluginBusy) !== null) {
    return null
  }

  registry.set(pluginBusy, pid)

  try {
    return await lookUp(registry, info)
  } finally {
    registry.set(pluginBusy, null)
  }
}

export interface CheckFailure {
  readonly title: string
  readonly reason: string
}

export interface CheckedAll {
  readonly failures: readonly CheckFailure[]
  readonly cancelled: boolean
}

const drains = new WeakMap<AtomRegistry.AtomRegistry, Promise<CheckedAll>>()

const drain = async (registry: AtomRegistry.AtomRegistry): Promise<CheckedAll> => {
  const failures: CheckFailure[] = []

  for (;;) {
    const state = registry.get(updatesChecking)
    const next = state?.left[0]

    if (state === null || next === undefined) {
      drains.delete(registry)
      registry.set(updatesChecking, null)

      return { failures, cancelled: state === null }
    }

    registry.set(updatesChecking, { ...state, current: next.title })
    registry.set(pluginBusy, next.id)
    const checked = await lookUp(registry, next)
    registry.set(pluginBusy, null)
    const after = registry.get(updatesChecking)

    if (after === null) {
      continue
    }

    if (checked._tag === "Failed" && !after.auto) {
      failures.push({ title: next.title, reason: checked.reason })
    }

    registry.set(updatesChecking, {
      ...after,
      left: after.left.filter((one) => one.id !== next.id),
    })
  }
}

const startChecking = async (
  registry: AtomRegistry.AtomRegistry,
  auto: boolean,
  plugins: readonly PluginInfo[],
) => {
  const before = registry.get(updatesChecking)
  registry.set(updatesChecking, { auto, left: plugins, current: before?.current ?? null })
  const running = drains.get(registry)

  if (running !== undefined) {
    return await running
  }

  const started = drain(registry)
  drains.set(registry, started)

  return await started
}

export const checkAllUpdates = async (
  registry: AtomRegistry.AtomRegistry,
  themes: boolean,
): Promise<CheckedAll> => {
  const checking = registry.get(updatesChecking)
  const plugins = enabledPlugins(registry, themes).slice(0, 32)

  if ((checking !== null && !checking.auto) || plugins.length === 0) {
    return { failures: [], cancelled: true }
  }

  return await startChecking(registry, false, plugins)
}

export const cancelChecking = (registry: AtomRegistry.AtomRegistry) => {
  if (registry.get(updatesChecking)?.auto === false) {
    registry.set(updatesChecking, null)
  }
}

const shuffled = <A>(items: readonly A[]) =>
  items
    .map((item) => ({ item, order: Math.random() }))
    .toSorted((left, right) => left.order - right.order)
    .map(({ item }) => item)

const autoCheck = (registry: AtomRegistry.AtomRegistry) => {
  if (!autoCheckDue(registry.get(lastAutoCheck), Date.now())) {
    return
  }

  registry.set(lastAutoCheck, Date.now())

  if (registry.get(updatesDownloading) || registry.get(updatesChecking) !== null) {
    return
  }

  const plugins = shuffled(enabledPlugins(registry, null)).slice(0, 16)

  if (plugins.length > 0) {
    void startChecking(registry, true, plugins)
  }
}

export const watchUpdates = (registry: AtomRegistry.AtomRegistry) => {
  if (navigator.onLine) {
    autoCheck(registry)
  }

  window.addEventListener("online", () => {
    autoCheck(registry)
  })
}

export const setAutoCheck = (registry: AtomRegistry.AtomRegistry, on: boolean) => {
  registry.set(lastAutoCheck, on)
}

export const updatePlugin = async (
  registry: AtomRegistry.AtomRegistry,
  pid: string,
): Promise<Updated | null> => {
  const coming = registry.get(updatesComing).find((one) => one.pid === pid)

  if (coming === undefined || registry.get(pluginBusy) !== null) {
    return null
  }

  registry.set(pluginBusy, pid)

  try {
    await replacePlugin(registry, coming.latest)
    withoutComing(registry, pid)

    return { _tag: "Updated", title: coming.title, version: coming.latest.version }
  } catch (error) {
    const reason = reasonOf(error)
    registry.set(
      updatesComing,
      registry
        .get(updatesComing)
        .map((one) => (one.pid === pid ? { ...one, failed: reason } : one)),
    )

    return { _tag: "Failed", pid, reason }
  } finally {
    registry.set(pluginBusy, null)
  }
}

export const updateSelected = async (
  registry: AtomRegistry.AtomRegistry,
): Promise<readonly Updated[]> => {
  if (registry.get(updatesDownloading)) {
    return []
  }

  registry.set(updatesDownloading, true)
  const done: Updated[] = []

  try {
    for (;;) {
      const unchecked = registry.get(updatesUnchecked)

      const next = registry
        .get(updatesComing)
        .find((one) => one.failed === null && !unchecked.includes(one.pid))

      if (next === undefined) {
        break
      }

      const result = await updatePlugin(registry, next.pid)

      if (result === null) {
        break
      }

      done.push(result)
    }
  } finally {
    registry.set(updatesDownloading, false)
  }

  return done
}
