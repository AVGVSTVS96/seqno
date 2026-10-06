import { Data, Effect, Layer } from "effect"
import { Entry, FileUnavailable, Storage } from "./storage.ts"

export type PlaceholderStyle = "dataless" | "stub" | "silent"

export interface FakeCloudOptions {
  readonly seed: number
  readonly placeholders: PlaceholderStyle
  readonly autoDownload: boolean
  readonly deliverChance: number
}

type Job = Data.TaggedEnum<{
  Upload: { readonly device: string; readonly path: string; readonly bytes: Uint8Array | undefined }
  Notify: { readonly device: string; readonly path: string }
  Download: { readonly device: string; readonly path: string }
}>
const Job = Data.taggedEnum<Job>()

export interface FakeCloud {
  readonly layer: (device: string) => Layer.Layer<Storage>
  readonly step: () => void
  readonly settle: () => void
  readonly evict: (device: string, path: string) => void
  readonly put: (path: string, bytes: Uint8Array) => void
  readonly files: () => ReadonlyArray<string>
}

const random = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const makeFakeCloud = (options: FakeCloudOptions): FakeCloud => {
  const next = random(options.seed)
  const server = new Map<string, Uint8Array>()
  const views = new Map<string, Map<string, Uint8Array | undefined>>()
  const jobs: Array<Job> = []

  const viewOf = (device: string) => {
    const existing = views.get(device)
    if (existing !== undefined) return existing
    const view = new Map<string, Uint8Array | undefined>(
      [...server].map(([path, bytes]) => [path, options.autoDownload ? bytes : undefined]),
    )
    views.set(device, view)
    return view
  }

  const notifyOthers = (from: string | undefined, path: string) => {
    for (const device of views.keys()) {
      if (device !== from) jobs.push(Job.Notify({ device, path }))
    }
  }

  const run = Job.$match({
    Upload: ({ device, path, bytes }) => {
      if (bytes === undefined) server.delete(path)
      else server.set(path, bytes)
      notifyOthers(device, path)
    },
    Notify: ({ device, path }) => {
      const view = viewOf(device)
      const bytes = server.get(path)
      if (bytes === undefined) view.delete(path)
      else if (view.get(path) !== bytes) view.set(path, options.autoDownload ? bytes : undefined)
    },
    Download: ({ device, path }) => {
      const view = viewOf(device)
      const bytes = server.get(path)
      if (bytes !== undefined && view.has(path)) view.set(path, bytes)
    },
  })

  const step = () => {
    const due = jobs.splice(0).filter((job) => {
      if (next() < options.deliverChance) return true
      jobs.push(job)
      return false
    })
    for (let index = due.length - 1; index > 0; index--) {
      const other = Math.floor(next() * (index + 1))
      const job = due[index]
      const swap = due[other]
      if (job === undefined || swap === undefined) continue
      due[index] = swap
      due[other] = job
    }
    due.forEach(run)
  }

  const settle = () => {
    while (jobs.length > 0) jobs.splice(0).forEach(run)
  }

  const listed = (name: string, bytes: Uint8Array | undefined) =>
    bytes !== undefined
      ? Entry.File({ name, placeholder: false })
      : options.placeholders === "stub"
        ? Entry.File({ name: `.${name}.icloud`, placeholder: false })
        : Entry.File({ name, placeholder: options.placeholders === "dataless" })

  const storage = (device: string): Storage["Service"] => {
    const view = viewOf(device)
    return {
      list: (dir) =>
        Effect.sync(() => {
          const prefix = `${dir}/`
          const dirs = new Set<string>()
          const files: Array<Entry> = []
          for (const [path, bytes] of view) {
            if (!path.startsWith(prefix)) continue
            const rest = path.slice(prefix.length)
            const slash = rest.indexOf("/")
            if (slash >= 0) dirs.add(rest.slice(0, slash))
            else files.push(listed(rest, bytes))
          }
          return [...[...dirs].map((name) => Entry.Directory({ name })), ...files]
        }),
      read: (path) =>
        Effect.suspend(() => {
          const bytes = view.get(path)
          if (bytes !== undefined) return Effect.succeed(bytes)
          if (!view.has(path) || options.placeholders === "stub") {
            return Effect.fail(new FileUnavailable({ path, reason: "missing" }))
          }
          jobs.push(Job.Download({ device, path }))
          return options.placeholders === "silent"
            ? Effect.succeed(new Uint8Array(0))
            : Effect.fail(new FileUnavailable({ path, reason: "not-downloaded" }))
        }),
      write: (path, bytes) =>
        Effect.sync(() => {
          view.set(path, bytes)
          jobs.push(Job.Upload({ device, path, bytes }))
        }),
      remove: (path) =>
        Effect.sync(() => {
          view.delete(path)
          jobs.push(Job.Upload({ device, path, bytes: undefined }))
        }),
      download: (path) =>
        Effect.sync(() => {
          if (view.has(path) && view.get(path) === undefined) {
            jobs.push(Job.Download({ device, path }))
          }
        }),
    }
  }

  return {
    layer: (device) => Layer.succeed(Storage, storage(device)),
    step,
    settle,
    evict: (device, path) => {
      const view = viewOf(device)
      if (view.has(path)) view.set(path, undefined)
    },
    put: (path, bytes) => {
      server.set(path, bytes)
      notifyOthers(undefined, path)
    },
    files: () => [...server.keys()].sort(),
  }
}
