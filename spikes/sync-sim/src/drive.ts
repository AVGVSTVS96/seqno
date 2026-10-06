import { tiered, type Rng } from "./rng.ts"
import type { Scheduler } from "./scheduler.ts"

/**
 * dataless: name visible, stat() reports dataless, read() fails until downloaded (macOS, Chrome on a Mac).
 * stub: only ".<name>.icloud" is listed and reading it yields a small plist (older iOS / Files placeholders).
 */
export type PlaceholderStyle = "dataless" | "stub"

export interface DriveDeviceConfig {
  readonly style: PlaceholderStyle
  readonly autoDownload: boolean
  readonly clockSkewMs: number
  readonly clockJumpAt: number
  readonly clockJumpMs: number
}

export interface DriveConfig {
  readonly conflictCopyRate: number
  readonly downloadFailRate: number
  readonly evictEveryMs: number
  readonly evictFraction: number
}

export interface DriveHooks {
  readonly onServerWrite: (path: string, bytes: Uint8Array, owner: number, conflictCopy: boolean) => void
  readonly onServerDelete: (path: string) => void
  readonly onDeviceWrite: (device: number, path: string) => void
  readonly onDeviceRemove: (device: number, path: string) => void
  readonly onViewChange: (device: number) => void
}

export interface Stat {
  readonly size: number
  readonly mtime: number
  readonly dataless: boolean
}

/** What a platform adapter exposes to the sync engine: plain file operations plus "please download". */
export interface DriveFs {
  readonly list: (dir: string) => readonly string[]
  readonly stat: (path: string) => Stat | undefined
  readonly read: (path: string) => Uint8Array
  readonly write: (path: string, bytes: Uint8Array) => void
  readonly remove: (path: string) => void
  readonly download: (path: string) => void
  readonly wallClock: () => number
}

export class NotDownloaded extends Error {}
export class NotFound extends Error {}

const STUB_PLIST = new TextEncoder().encode('<?xml version="1.0"?><plist><dict><key>NSURLFileSizeKey</key></dict></plist>')

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

type Pending = { readonly kind: "write"; readonly bytes: Uint8Array; readonly mtime: number } | { readonly kind: "delete" }

interface DeviceState {
  readonly id: number
  readonly cfg: DriveDeviceConfig
  online: boolean
  readonly view: Map<string, Entry>
  readonly dirs: Map<string, Set<string>>
  readonly outbox: Map<string, Pending>
  readonly uploading: Set<string>
  readonly deferredNotify: Set<string>
  readonly wantDownload: Set<string>
  readonly downloading: Set<string>
}

const split = (path: string) => {
  const i = path.lastIndexOf("/")
  return [path.slice(0, i), path.slice(i + 1)] as const
}

export const conflictCopyName = (path: string, n: number) => {
  const [dir, name] = split(path)
  const dot = name.lastIndexOf(".")
  return `${dir}/${name.slice(0, dot)} ${n}${name.slice(dot)}`
}

export interface DriveStats {
  uploads: number
  uploadBytes: number
  downloadBytes: number
  conflictCopies: number
  evictions: number
  downloadFailures: number
  stubReads: number
  datalessReads: number
  downloads: number
}

export class Drive {
  readonly server = new Map<string, ServerFile>()
  readonly stats: DriveStats = {
    uploads: 0,
    uploadBytes: 0,
    downloadBytes: 0,
    conflictCopies: 0,
    evictions: 0,
    downloadFailures: 0,
    stubReads: 0,
    datalessReads: 0,
    downloads: 0,
  }
  private version = 0
  private inFlight = 0
  private readonly devices: DeviceState[]
  private readonly sched: Scheduler
  private readonly rng: Rng
  private readonly cfg: DriveConfig
  private readonly hooks: DriveHooks

  constructor(sched: Scheduler, rng: Rng, cfg: DriveConfig, deviceConfigs: readonly DriveDeviceConfig[], hooks: DriveHooks) {
    this.sched = sched
    this.rng = rng
    this.cfg = cfg
    this.hooks = hooks
    this.devices = deviceConfigs.map((c, id) => ({
      id,
      cfg: c,
      online: true,
      view: new Map(),
      dirs: new Map(),
      outbox: new Map(),
      uploading: new Set(),
      deferredNotify: new Set(),
      wantDownload: new Set(),
      downloading: new Set(),
    }))
    for (const d of this.devices) this.scheduleEviction(d)
  }

  /** True when nothing is queued, in flight, or waiting for a device to come back online. */
  get idle() {
    return (
      this.inFlight === 0 &&
      this.devices.every((d) => d.outbox.size === 0 && d.deferredNotify.size === 0 && d.wantDownload.size === 0)
    )
  }

  isOnline(id: number) {
    return this.devices[id]!.online
  }

  setOnline(id: number, online: boolean) {
    const d = this.devices[id]!
    if (d.online === online) return
    d.online = online
    if (!online) return
    this.pump(d)
    for (const path of d.deferredNotify) this.notify(d, path)
    d.deferredNotify.clear()
    for (const path of d.wantDownload) this.startDownload(d, path)
    this.hooks.onViewChange(d.id)
  }

  fs(id: number): DriveFs {
    const d = this.devices[id]!
    const wallClock = () => {
      const now = this.sched.now
      return Math.floor(now + d.cfg.clockSkewMs + (now >= d.cfg.clockJumpAt ? d.cfg.clockJumpMs : 0))
    }
    const parseStub = (path: string) => {
      const [dir, name] = split(path)
      const m = /^\.(.+)\.icloud$/.exec(name)
      return m ? `${dir}/${m[1]}` : undefined
    }
    return {
      wallClock,
      list: (dir) => {
        const out: string[] = []
        for (const [sub, names] of d.dirs) {
          if (names.size > 0 && sub.startsWith(`${dir}/`) && !sub.slice(dir.length + 1).includes("/"))
            out.push(sub.slice(dir.length + 1))
        }
        for (const name of d.dirs.get(dir) ?? []) {
          const e = d.view.get(`${dir}/${name}`)!
          out.push(d.cfg.style === "stub" && e.bytes === null ? `.${name}.icloud` : name)
        }
        return out
      },
      stat: (path) => {
        const real = d.cfg.style === "stub" ? parseStub(path) : undefined
        if (real !== undefined) {
          const e = d.view.get(real)
          return e && e.bytes === null ? { size: STUB_PLIST.length, mtime: e.mtime, dataless: false } : undefined
        }
        const e = d.view.get(path)
        if (!e) return undefined
        if (e.bytes === null && d.cfg.style === "stub") return undefined
        return { size: e.size, mtime: e.mtime, dataless: e.bytes === null }
      },
      read: (path) => {
        const real = d.cfg.style === "stub" ? parseStub(path) : undefined
        if (real !== undefined) {
          const e = d.view.get(real)
          if (!e || e.bytes !== null) throw new NotFound(path)
          this.stats.stubReads++
          return STUB_PLIST
        }
        const e = d.view.get(path)
        if (!e || (e.bytes === null && d.cfg.style === "stub")) throw new NotFound(path)
        if (e.bytes === null) {
          this.stats.datalessReads++
          this.requestDownload(d, path)
          throw new NotDownloaded(path)
        }
        return e.bytes
      },
      write: (path, bytes) => {
        this.hooks.onDeviceWrite(d.id, path)
        this.setEntry(d, path, { version: -1, size: bytes.length, mtime: wallClock(), bytes })
        d.outbox.set(path, { kind: "write", bytes, mtime: wallClock() })
        this.pump(d)
      },
      remove: (path) => {
        this.hooks.onDeviceRemove(d.id, path)
        this.removeEntry(d, path)
        d.outbox.set(path, { kind: "delete" })
        this.pump(d)
      },
      download: (path) => {
        const e = d.view.get(path)
        if (e && e.bytes === null) this.requestDownload(d, path)
      },
    }
  }

  private setEntry(d: DeviceState, path: string, entry: Entry) {
    const [dir, name] = split(path)
    d.view.set(path, entry)
    let names = d.dirs.get(dir)
    if (!names) d.dirs.set(dir, (names = new Set()))
    names.add(name)
  }

  private removeEntry(d: DeviceState, path: string) {
    const [dir, name] = split(path)
    d.view.delete(path)
    d.dirs.get(dir)?.delete(name)
  }

  private pump(d: DeviceState) {
    if (!d.online) return
    for (const path of d.outbox.keys()) if (!d.uploading.has(path)) this.startUpload(d, path)
  }

  private startUpload(d: DeviceState, path: string) {
    const op = d.outbox.get(path)!
    d.uploading.add(path)
    this.inFlight++
    const delay = tiered(this.rng, [
      [0.85, 500, 5_000],
      [0.13, 5_000, 120_000],
      [0.02, 120_000, 1_800_000],
    ])
    this.sched.after(delay, () => {
      this.inFlight--
      d.uploading.delete(path)
      if (!d.online) return
      if (d.outbox.get(path) === op) d.outbox.delete(path)
      this.applyToServer(d, path, op)
      if (d.outbox.has(path)) this.startUpload(d, path)
    })
  }

  private applyToServer(d: DeviceState, path: string, op: Pending) {
    if (op.kind === "delete") {
      if (!this.server.delete(path)) return
      this.hooks.onServerDelete(path)
      this.notifyAll(path, d)
      return
    }
    const previous = this.server.get(path)
    const version = ++this.version
    this.server.set(path, { bytes: op.bytes, version, mtime: op.mtime })
    this.stats.uploads++
    this.stats.uploadBytes += op.bytes.length
    const local = d.view.get(path)
    if (local && !d.outbox.has(path)) local.version = version
    this.hooks.onServerWrite(path, op.bytes, d.id, false)
    this.notifyAll(path, d)
    if (!this.rng.chance(this.cfg.conflictCopyRate)) return
    let n = 2
    while (this.server.has(conflictCopyName(path, n))) n++
    const copy = conflictCopyName(path, n)
    const bytes = previous?.bytes ?? op.bytes
    this.server.set(copy, { bytes, version: ++this.version, mtime: op.mtime })
    this.stats.conflictCopies++
    this.hooks.onServerWrite(copy, bytes, d.id, true)
    this.notifyAll(copy)
  }

  private notifyAll(path: string, except?: DeviceState) {
    for (const d of this.devices) if (d !== except) this.notify(d, path)
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
    this.sched.after(delay, () => {
      this.inFlight--
      if (!d.online) d.deferredNotify.add(path)
      else this.refresh(d, path)
    })
  }

  /** Bring one path of a device's view in line with the server, as a placeholder. */
  private refresh(d: DeviceState, path: string) {
    if (d.outbox.has(path)) return
    const s = this.server.get(path)
    const local = d.view.get(path)
    if (!s) {
      if (local) {
        this.removeEntry(d, path)
        this.hooks.onViewChange(d.id)
      }
      return
    }
    if (local && local.version === s.version) return
    this.setEntry(d, path, { version: s.version, size: s.bytes.length, mtime: s.mtime, bytes: null })
    if (d.cfg.autoDownload) this.requestDownload(d, path)
    this.hooks.onViewChange(d.id)
  }

  private requestDownload(d: DeviceState, path: string) {
    if (d.wantDownload.has(path)) return
    d.wantDownload.add(path)
    this.startDownload(d, path)
  }

  private startDownload(d: DeviceState, path: string) {
    if (!d.online || d.downloading.has(path)) return
    d.downloading.add(path)
    this.inFlight++
    const delay = tiered(this.rng, [
      [0.85, 300, 5_000],
      [0.13, 5_000, 120_000],
      [0.02, 120_000, 900_000],
    ])
    this.sched.after(delay, () => {
      this.inFlight--
      d.downloading.delete(path)
      if (!d.online) return
      d.wantDownload.delete(path)
      if (this.rng.chance(this.cfg.downloadFailRate)) {
        this.stats.downloadFailures++
        this.hooks.onViewChange(d.id)
        return
      }
      if (d.outbox.has(path)) return
      const s = this.server.get(path)
      if (!s) this.removeEntry(d, path)
      else {
        this.stats.downloads++
        this.stats.downloadBytes += s.bytes.length
        this.setEntry(d, path, { version: s.version, size: s.bytes.length, mtime: s.mtime, bytes: s.bytes })
      }
      this.hooks.onViewChange(d.id)
    })
  }

  private scheduleEviction(d: DeviceState) {
    this.sched.after(this.rng.exp(this.cfg.evictEveryMs), () => {
      for (const [path, e] of d.view) {
        if (e.bytes !== null && !d.outbox.has(path) && this.rng.chance(this.cfg.evictFraction)) {
          e.bytes = null
          this.stats.evictions++
        }
      }
      this.scheduleEviction(d)
    })
  }
}
