import { summarize } from "./stats.ts"
import type { OpenMode, Ops } from "./worker.ts"

type Reply = { id: number; ok: unknown } | { id: number; error: string }

const spawn = () => {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  const pending = new Map<number, PromiseWithResolvers<unknown>>()
  let nextId = 0
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    const call = pending.get(data.id)!
    pending.delete(data.id)
    if ("error" in data) call.reject(new Error(data.error))
    else call.resolve(data.ok)
  }
  worker.onerror = (event) => pending.forEach((call) => call.reject(new Error(event.message)))
  const call = <K extends keyof Ops>(op: K, ...arg: Parameters<Ops[K]>): Promise<Awaited<ReturnType<Ops[K]>>> => {
    const id = nextId++
    const reply = Promise.withResolvers<unknown>()
    pending.set(id, reply)
    worker.postMessage({ id, op, arg: arg[0] })
    return reply.promise as never
  }
  return { call, terminate: () => worker.terminate() }
}

let session: ReturnType<typeof spawn>

const bench = {
  async coldOpen(mode: OpenMode) {
    const t0 = performance.now()
    const worker = spawn()
    const open = await worker.call("open", mode)
    const spawnToBlockMapMs = performance.now() - t0
    const merge = mode === "snapshot" ? null : await worker.call("merge")
    worker.terminate()
    return { ...open, spawnToBlockMapMs, merge }
  },

  async coldOpenFirstPage(pageUuid: string) {
    const worker = spawn()
    const result = await worker.call("openFirstPage", pageUuid)
    worker.terminate()
    return result
  },

  async openSession() {
    session = spawn()
    return session.call("open", "snapshotThenUpdates")
  },

  wasmMemoryBytes: () => session.call("wasmMemoryBytes"),

  localEdits: (saveEvery: number) => session.call("localEdits", saveEvery),

  async keystrokes(plan: { count: number; seed: number }) {
    const workerMs: number[] = []
    const roundTripMs: number[] = []
    for (const keystroke of await session.call("planKeystrokes", plan)) {
      const t0 = performance.now()
      const { workerMs: ms, text } = await session.call("keystroke", keystroke)
      roundTripMs.push(performance.now() - t0)
      workerMs.push(ms)
      if (!text.includes(keystroke.char)) throw new Error(`keystroke not applied to ${keystroke.uuid}`)
    }
    return { worker: summarize(workerMs), roundTrip: summarize(roundTripMs) }
  },

  async moves({ count, seed }: { count: number; seed: number }) {
    await session.call("seedMoves", seed)
    const workerMs: number[] = []
    const roundTripMs: number[] = []
    const subtreeBlocks: number[] = []
    for (let i = 0; i < count; i++) {
      const move = await session.call("nextMove")
      const t0 = performance.now()
      const result = await session.call("move", move)
      roundTripMs.push(performance.now() - t0)
      workerMs.push(result.workerMs)
      subtreeBlocks.push(result.subtreeBlocks)
      if (!result.parentOk) throw new Error(`move of ${move.uuid} did not land under ${move.parent}`)
    }
    return { worker: summarize(workerMs), roundTrip: summarize(roundTripMs), subtreeBlocks: summarize(subtreeBlocks) }
  },

  blockMapMatchesLoro: () => session.call("blockMapMatchesLoro"),

  sizes: () => session.call("sizes"),

  sqliteIndex: () => session.call("sqliteIndex"),
}

export type Bench = typeof bench

declare global {
  interface Window {
    bench: Bench
  }
}

window.bench = bench
