import { Data, Effect, Match, Option } from "effect"
import { tiered, type Rng } from "./rng.ts"
import type { Scheduler } from "./scheduler.ts"
import { at, splitPath, stubTarget } from "./util.ts"

export type PlaceholderStyle = "dataless" | "stub"

export interface CloudDeviceConfig {
  readonly style: PlaceholderStyle
  readonly autoDownload: boolean
}

export interface CloudConfig {
  readonly conflictCopyRate: number
  readonly downloadFailRate: number
  readonly evictEveryMs: number
  readonly evictFraction: number
}

export interface CloudHooks {
  readonly onServerWrite: (path: string, bytes: Uint8Array, owner: number, conflictCopy: boolean) => void
  readonly onServerDelete: (path: string) => void
  readonly onDeviceWrite: (device: number, path: string, bytes: Uint8Array) => void
  readonly onDeviceRemove: (device: number, path: string) => void
  readonly onViewChange: (device: number) => void
}

export interface Stat {
  readonly size: number
  readonly mtime: number
  readonly dataless: boolean
}

export class NotDownloaded extends Data.TaggedError("NotDownloaded")<{ readonly path: string }> {}

export class NotFound extends Data.TaggedError("NotFound")<{ readonly path: string }> {}

export interface CloudFs {
  readonly list: (dir: string) => Effect.Effect<ReadonlyArray<string>>
  readonly stat: (path: string) => Effect.Effect<Option.Option<Stat>>
  readonly read: (path: string) => Effect.Effect<Uint8Array, NotDownloaded | NotFound>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void>
  readonly remove: (path: string) => Effect.Effect<void>
  readonly download: (path: string) => Effect.Effect<void>
}

export interface CloudStats {
  uploads: number
  uploadBytes: number
  downloads: number
  downloadBytes: number
  conflictCopies: number
  evictions: number
  downloadFailures: number
  stubReads: number
  datalessReads: number
}

const STUB_PLIST = new TextEncoder().encode(
  '<?xml version="1.0"?><plist><dict><key>NSURLFileSizeKey</key></dict></plist>',
)

interface ServerFile {
  readonly bytes: Uint8Array
  readonly version: number
  readonly mtime: number
}

interface Entry {
  version: number
  size: number
  mtime: number
  bytes: Uint8Array | null
}

type Pending =
  | { readonly _tag: "Write"; readonly bytes: Uint8Array; readonly mtime: number }
  | { readonly _tag: "Delete" }

interface DeviceState {
  readonly id: number
  readonly cfg: CloudDeviceConfig
  online: boolean
  readonly view: Map<string, Entry>
  readonly dirs: Map<string, Set<string>>
  readonly outbox: Map<string, Pending>
  readonly uploading: Set<string>
  readonly deferredNotify: Set<string>
  readonly wantDownload: Set<string>
  readonly downloading: Set<string>
}

export const conflictCopyName = (path: string, n: number): string => {
  const [dir, name] = splitPath(path)
  const dot = name.lastIndexOf(".")
  return `${dir}/${name.slice(0, dot)} ${n}${name.slice(dot)}`
}

export class FakeICloud {
  readonly server = new Map<string, ServerFile>()
  readonly stats: CloudStats = {
    uploads: 0,
    uploadBytes: 0,
    downloads: 0,
    downloadBytes: 0,
    conflictCopies: 0,
    evictions: 0,
    downloadFailures: 0,
    stubReads: 0,
    datalessReads: 0,
  }
  private version = 0
  private inFlight = 0
  private readonly devices: ReadonlyArray<DeviceState>
  private readonly sched: Scheduler
  private readonly rng: Rng
  private readonly cfg: CloudConfig
  private readonly hooks: CloudHooks

  constructor(
    sched: Scheduler,
    rng: Rng,
    cfg: CloudConfig,
    deviceConfigs: ReadonlyArray<CloudDeviceConfig>,
    hooks: CloudHooks,
  ) {
    this.sched = sched
    this.rng = rng
    this.cfg = cfg
    this.hooks = hooks
    this.devices = deviceConfigs.map((config, id) => ({
      id,
      cfg: config,
      online: true,
      view: new Map(),
      dirs: new Map(),
      outbox: new Map(),
      uploading: new Set(),
      deferredNotify: new Set(),
      wantDownload: new Set(),
      downloading: new Set(),
    }))
    for (const device of this.devices) {
      this.scheduleEviction(device)
    }
  }

  get idle(): boolean {
    return (
      this.inFlight === 0 &&
      this.devices.every(
        (d) => d.outbox.size === 0 && d.deferredNotify.size === 0 && d.wantDownload.size === 0,
      )
    )
  }

  isOnline(id: number): boolean {
    return at(this.devices, id).online
  }

  setOnline(id: number, online: boolean) {
    const d = at(this.devices, id)
    if (d.online === online) {
      return
    }
    d.online = online
    if (!online) {
      return
    }
    this.pump(d)
    for (const path of d.deferredNotify) {
      this.notify(d, path)
    }
    d.deferredNotify.clear()
    for (const path of d.wantDownload) {
      this.startDownload(d, path)
    }
    this.hooks.onViewChange(d.id)
  }

  fs(id: number): CloudFs {
    const d = at(this.devices, id)
    const stub = d.cfg.style === "stub"
    const placeholderOf = (path: string) => {
      const [dir, name] = splitPath(path)
      const target = stub ? stubTarget(name) : undefined
      return target === undefined ? undefined : `${dir}/${target}`
    }
    return {
      list: (dir) =>
        Effect.sync(() => {
          const prefix = `${dir}/`
          const out: string[] = []
          for (const [sub, names] of d.dirs) {
            if (names.size > 0 && sub.startsWith(prefix) && !sub.slice(prefix.length).includes("/")) {
              out.push(sub.slice(prefix.length))
            }
          }
          for (const name of d.dirs.get(dir) ?? []) {
            const entry = d.view.get(`${dir}/${name}`)
            out.push(stub && entry?.bytes === null ? `.${name}.icloud` : name)
          }
          return out
        }),
      stat: (path) =>
        Effect.sync(() => {
          const real = placeholderOf(path)
          if (real !== undefined) {
            const entry = d.view.get(real)
            return entry !== undefined && entry.bytes === null
              ? Option.some({ size: STUB_PLIST.length, mtime: entry.mtime, dataless: false })
              : Option.none()
          }
          const entry = d.view.get(path)
          if (entry === undefined || (entry.bytes === null && stub)) {
            return Option.none()
          }
          return Option.some({ size: entry.size, mtime: entry.mtime, dataless: entry.bytes === null })
        }),
      read: (path) =>
        Effect.suspend((): Effect.Effect<Uint8Array, NotDownloaded | NotFound> => {
          const real = placeholderOf(path)
          if (real !== undefined) {
            const entry = d.view.get(real)
            if (entry === undefined || entry.bytes !== null) {
              return Effect.fail(new NotFound({ path }))
            }
            this.stats.stubReads++
            return Effect.succeed(STUB_PLIST)
          }
          const entry = d.view.get(path)
          if (entry === undefined || (entry.bytes === null && stub)) {
            return Effect.fail(new NotFound({ path }))
          }
          if (entry.bytes === null) {
            this.stats.datalessReads++
            this.requestDownload(d, path)
            return Effect.fail(new NotDownloaded({ path }))
          }
          return Effect.succeed(entry.bytes)
        }),
      write: (path, bytes) =>
        Effect.sync(() => {
          this.hooks.onDeviceWrite(d.id, path, bytes)
          const mtime = this.sched.now
          this.setEntry(d, path, { version: -1, size: bytes.length, mtime, bytes })
          d.outbox.set(path, { _tag: "Write", bytes, mtime })
          this.pump(d)
        }),
      remove: (path) =>
        Effect.sync(() => {
          this.hooks.onDeviceRemove(d.id, path)
          this.removeEntry(d, path)
          d.outbox.set(path, { _tag: "Delete" })
          this.pump(d)
        }),
      download: (path) =>
        Effect.sync(() => {
          const real = placeholderOf(path) ?? path
          if (d.view.get(real)?.bytes === null) {
            this.requestDownload(d, real)
          }
        }),
    }
  }

  private setEntry(d: DeviceState, path: string, entry: Entry) {
    const [dir, name] = splitPath(path)
    d.view.set(path, entry)
    const names = d.dirs.get(dir) ?? new Set<string>()
    d.dirs.set(dir, names)
    names.add(name)
  }

  private removeEntry(d: DeviceState, path: string) {
    const [dir, name] = splitPath(path)
    d.view.delete(path)
    d.dirs.get(dir)?.delete(name)
  }

  private pump(d: DeviceState) {
    if (!d.online) {
      return
    }
    for (const [path, op] of d.outbox) {
      if (!d.uploading.has(path)) {
        this.startUpload(d, path, op)
      }
    }
  }

  private startUpload(d: DeviceState, path: string, op: Pending) {
    d.uploading.add(path)
    this.inFlight++
    const delay = tiered(this.rng, [
      [0.85, 500, 5_000],
      [0.13, 5_000, 120_000],
      [0.02, 120_000, 1_800_000],
    ])
    this.sched.soon(delay, () => {
      this.inFlight--
      d.uploading.delete(path)
      if (!d.online) {
        return
      }
      if (d.outbox.get(path) === op) {
        d.outbox.delete(path)
      }
      this.applyToServer(d, path, op)
      const next = d.outbox.get(path)
      if (next !== undefined) {
        this.startUpload(d, path, next)
      }
    })
  }

  private applyToServer(d: DeviceState, path: string, op: Pending) {
    Match.valueTags(op, {
      Delete: () => {
        if (this.server.delete(path)) {
          this.hooks.onServerDelete(path)
          this.notifyAll(path, d)
        }
      },
      Write: ({ bytes, mtime }) => this.writeToServer(d, path, bytes, mtime),
    })
  }

  private writeToServer(d: DeviceState, path: string, bytes: Uint8Array, mtime: number) {
    const previous = this.server.get(path)
    const version = ++this.version
    this.server.set(path, { bytes, version, mtime })
    this.stats.uploads++
    this.stats.uploadBytes += bytes.length
    const local = d.view.get(path)
    if (local !== undefined && !d.outbox.has(path)) {
      local.version = version
    }
    this.hooks.onServerWrite(path, bytes, d.id, false)
    this.notifyAll(path, d)
    if (!this.rng.chance(this.cfg.conflictCopyRate)) {
      return
    }
    let n = 2
    while (this.server.has(conflictCopyName(path, n))) {
      n++
    }
    const copy = conflictCopyName(path, n)
    const copyBytes = previous?.bytes ?? bytes
    this.server.set(copy, { bytes: copyBytes, version: ++this.version, mtime })
    this.stats.conflictCopies++
    this.hooks.onServerWrite(copy, copyBytes, d.id, true)
    this.notifyAll(copy, undefined)
  }

  private notifyAll(path: string, except: DeviceState | undefined) {
    for (const d of this.devices) {
      if (d !== except) {
        this.notify(d, path)
      }
    }
  }

  private notify(d: DeviceState, path: string) {
    if (!d.online) {
      d.deferredNotify.add(path)
      return
    }
    this.inFlight++
    const delay = tiered(this.rng, [
      [0.8, 1_000, 15_000],
      [0.17, 15_000, 300_000],
      [0.03, 300_000, 3_600_000],
    ])
    this.sched.soon(delay, () => {
      this.inFlight--
      if (d.online) {
        this.refresh(d, path)
      } else {
        d.deferredNotify.add(path)
      }
    })
  }

  private refresh(d: DeviceState, path: string) {
    if (d.outbox.has(path)) {
      return
    }
    const remote = this.server.get(path)
    const local = d.view.get(path)
    if (remote === undefined) {
      if (local !== undefined) {
        this.removeEntry(d, path)
        this.hooks.onViewChange(d.id)
      }
      return
    }
    if (local !== undefined && local.version === remote.version) {
      return
    }
    this.setEntry(d, path, {
      version: remote.version,
      size: remote.bytes.length,
      mtime: remote.mtime,
      bytes: null,
    })
    if (d.cfg.autoDownload) {
      this.requestDownload(d, path)
    }
    this.hooks.onViewChange(d.id)
  }

  private requestDownload(d: DeviceState, path: string) {
    if (d.wantDownload.has(path)) {
      return
    }
    d.wantDownload.add(path)
    this.startDownload(d, path)
  }

  private startDownload(d: DeviceState, path: string) {
    if (!d.online || d.downloading.has(path)) {
      return
    }
    d.downloading.add(path)
    this.inFlight++
    const delay = tiered(this.rng, [
      [0.85, 300, 5_000],
      [0.13, 5_000, 120_000],
      [0.02, 120_000, 900_000],
    ])
    this.sched.soon(delay, () => {
      this.inFlight--
      d.downloading.delete(path)
      if (!d.online) {
        return
      }
      d.wantDownload.delete(path)
      if (this.rng.chance(this.cfg.downloadFailRate)) {
        this.stats.downloadFailures++
        this.hooks.onViewChange(d.id)
        return
      }
      if (d.outbox.has(path)) {
        return
      }
      const remote = this.server.get(path)
      if (remote === undefined) {
        this.removeEntry(d, path)
      } else {
        this.stats.downloads++
        this.stats.downloadBytes += remote.bytes.length
        this.setEntry(d, path, {
          version: remote.version,
          size: remote.bytes.length,
          mtime: remote.mtime,
          bytes: remote.bytes,
        })
      }
      this.hooks.onViewChange(d.id)
    })
  }

  private scheduleEviction(d: DeviceState) {
    this.sched.soon(this.rng.exp(this.cfg.evictEveryMs), () => {
      for (const [path, entry] of d.view) {
        if (entry.bytes !== null && !d.outbox.has(path) && this.rng.chance(this.cfg.evictFraction)) {
          entry.bytes = null
          this.stats.evictions++
        }
      }
      this.scheduleEviction(d)
    })
  }
}
