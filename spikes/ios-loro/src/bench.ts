import { applyEdits, createRng, generateEdits, graphDigest, type Graph } from "../vendor/fixture/index.ts"
import type { Doc, Engine, NodeId, TreeValue } from "./engine.ts"
import { applyEdit, loadBlockMap, openSession, toGraph, type BlockMap, type Session } from "./session.ts"

export interface FixtureMeta {
  readonly seed: number
  readonly blocks: number
  readonly loro: string
  readonly graphDigest: string
  readonly afterMergeDigest: string
  readonly afterMerge2Digest: string
  readonly mergeEdits: number
}

export interface BenchInput {
  readonly snapshot: Uint8Array
  /** Three consecutive batches of 1k edits from one remote peer. */
  readonly merges: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly meta: FixtureMeta
}

export interface BenchHooks {
  readonly checkpoint: (name: string) => Promise<void>
  readonly heap: () => Record<string, number>
}

export interface Stats {
  readonly n: number
  readonly mean: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
}

const now = () => performance.now()
const round = (ms: number) => Math.round(ms * 1000) / 1000

export const stats = (samples: readonly number[]): Stats => {
  const s = [...samples].sort((a, b) => a - b)
  const at = (q: number) => round(s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!)
  return { n: s.length, mean: round(s.reduce((a, b) => a + b, 0) / s.length), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: round(s[s.length - 1]!) }
}

const timed = <A>(f: () => A): [A, number] => {
  const t0 = now()
  const value = f()
  return [value, round(now() - t0)]
}

/** Resolves once every event the last mutation produced has reached the block map. */
const delivered = async (session: Session, before: number) => {
  for (let i = 0; i < 10 && session.events.count === before; i++) await Promise.resolve()
  return session.events.count > before
}

const materializePage = (doc: Doc, page: NodeId) => {
  const blocks: { id: NodeId; uuid: unknown; text: unknown }[] = []
  const visit = (id: NodeId) => {
    for (const child of doc.children(id)) {
      blocks.push({ id: child, uuid: doc.getMeta(child, "uuid"), text: doc.getMeta(child, "text") })
      visit(child)
    }
  }
  visit(page)
  return blocks
}

const pageTree = (doc: Doc, id: NodeId): TreeValue => ({
  id,
  meta: { uuid: doc.getMeta(id, "uuid"), title: doc.getMeta(id, "title"), journalDay: doc.getMeta(id, "journalDay"), text: doc.getMeta(id, "text") },
  children: doc.children(id).map((child) => pageTree(doc, child)),
})

const biggestPage = (map: BlockMap) => {
  const size = (id: NodeId): number => map.entries.get(id)!.children.reduce((n, c) => n + 1 + size(c), 0)
  return map.roots.map((id) => [id, size(id)] as const).reduce((a, b) => (b[1] > a[1] ? b : a))
}

/** Kept in its own frame so the materialized tree value is garbage once the block map exists. */
const openFull = (doc: Doc) => {
  const [tree, materializeMs] = timed(() => doc.tree())
  const [map, blockMapMs] = timed(() => loadBlockMap(tree))
  return { map, materializeMs, blockMapMs }
}

/** The same three imports on a fresh doc with no subscriber, to separate engine cost from event delivery. */
const mergeWithoutEvents = (engine: Engine, { snapshot, merges }: BenchInput) => {
  const doc = engine.createDoc()
  doc.importBytes(snapshot)
  return merges.map((bytes) => timed(() => doc.importBytes(bytes))[1])
}

const KEYSTROKE_BLOCKS = 20
const CHARS_PER_BLOCK = 50
const WARMUP = 50
const MOVES = 1_000

/**
 * `full` materializes every block into the in-memory block map at open (what the web-perf spike measures).
 * `lazy` materializes only the page list and today's journal page; merges then update just that page.
 */
export type BenchMode = "full" | "lazy"

export const runBench = async (engine: Engine, { snapshot, merges, meta }: BenchInput, hooks: BenchHooks, mode: BenchMode = "full") => {
  const full = mode === "full"
  const check = (ok: () => boolean) => (full ? ok() : null)
  const options: Graph["options"] = { seed: meta.seed, blocks: meta.blocks, pages: 1_500, journals: 365 }
  const digestOf = (map: BlockMap) => graphDigest(toGraph(map, options))
  await hooks.checkpoint("baseline")

  const [doc, importMs] = timed(() => {
    const d = engine.createDoc()
    d.importBytes(snapshot)
    return d
  })
  await hooks.checkpoint("imported")

  const [pages, pageListMs] = timed(() =>
    doc.roots().map((id) => ({ id, title: doc.getMeta(id, "title"), journalDay: doc.getMeta(id, "journalDay") as number | undefined })),
  )
  const today = pages.reduce((a, b) => ((b.journalDay ?? 0) > (a.journalDay ?? 0) ? b : a))
  const [todayBlocks, todayMs] = timed(() => materializePage(doc, today.id))

  const { map, materializeMs, blockMapMs } = full
    ? openFull(doc)
    : { map: loadBlockMap([pageTree(doc, today.id)]), materializeMs: null, blockMapMs: null }
  const session = openSession(doc, map)
  const open = {
    importMs,
    materializeTreeMs: materializeMs,
    buildBlockMapMs: blockMapMs,
    fullOpenMs: full ? round(importMs + materializeMs! + blockMapMs!) : null,
    lazyOpenMs: round(importMs + pageListMs + todayMs),
    pageListMs,
    pages: pages.length,
    firstPageMs: todayMs,
    firstPageBlocks: todayBlocks.length,
    blocks: session.map.entries.size,
  }
  const lazyBiggestPage = full
    ? (() => {
        const [big, blocks] = biggestPage(session.map)
        return { blocks, ms: timed(() => materializePage(doc, big))[1] }
      })()
    : null
  const openDigestOk = check(() => digestOf(session.map) === meta.graphDigest)
  const heapOpened = hooks.heap()
  await hooks.checkpoint("opened")

  const importMerge = async (bytes: Uint8Array) => {
    const before = session.events.count
    const t0 = now()
    doc.importBytes(bytes)
    const synchronous = session.events.count > before
    await delivered(session, before)
    return { ms: round(now() - t0), eventsSynchronous: synchronous }
  }
  const mergeFirst = await importMerge(merges[0])
  const mergeFirstOk = check(() => digestOf(session.map) === meta.afterMergeDigest)
  const mergeWarm = await importMerge(merges[1])
  const mergeWarmOk = check(() => digestOf(session.map) === meta.afterMerge2Digest)

  const rng = createRng(meta.seed + 3)
  const blocks = [...session.map.entries.values()].filter((e) => e.parent !== null)
  const targets = Array.from({ length: KEYSTROKE_BLOCKS }, () => blocks[rng.int(0, blocks.length - 1)]!)
  const alphabet = "abcdefghijklmnopqrstuvwxyz     "
  const keystrokes: number[] = []
  let syncKeystrokes = 0
  const type = async (record: boolean) => {
    const target = targets[rng.int(0, targets.length - 1)]!
    const before = session.events.count
    const k0 = now()
    doc.insertText(target.id, "text", target.text.length, alphabet[rng.int(0, alphabet.length - 1)]!)
    doc.commit()
    if (session.events.count > before) syncKeystrokes++
    await delivered(session, before)
    if (record) keystrokes.push(now() - k0)
  }
  for (let i = 0; i < WARMUP; i++) await type(false)
  for (let i = 0; i < KEYSTROKE_BLOCKS * CHARS_PER_BLOCK; i++) await type(true)

  const mergeConcurrent = await importMerge(merges[2])
  const mergeConcurrentOk = check(() => digestOf(session.map) === digestOf(loadBlockMap(doc.tree())))

  const beforeMoves = toGraph(session.map, options)
  const moveEdits = !full ? [] : generateEdits(beforeMoves, {
    seed: meta.seed + 4,
    count: MOVES,
    mix: { insertText: 0, deleteText: 0, createBlock: 0, moveBlock: 1, deleteBlock: 0 },
  })
  const moves: number[] = []
  for (const edit of moveEdits) {
    const before = session.events.count
    const v0 = now()
    applyEdit(session, edit)
    await delivered(session, before)
    moves.push(now() - v0)
  }
  const movesOk = check(() => digestOf(session.map) === graphDigest(applyEdits(beforeMoves, moveEdits)))

  const [exported, exportMs] = timed(() => doc.exportSnapshot())
  const heapEnd = hooks.heap()
  await hooks.checkpoint("end")
  session.close()
  const [noEventsFirst, noEventsWarm, noEventsThird] = mergeWithoutEvents(engine, { snapshot, merges, meta })

  return {
    engine: engine.name,
    loro: engine.version,
    mode,
    blocks: meta.blocks,
    snapshotBytes: snapshot.byteLength,
    open,
    lazyBiggestPage,
    merge: {
      edits: meta.mergeEdits,
      bytes: merges.map((m) => m.byteLength),
      first: mergeFirst,
      warm: mergeWarm,
      concurrentWithLocalEdits: mergeConcurrent,
      withoutSubscriber: { firstMs: noEventsFirst, warmMs: noEventsWarm, thirdMs: noEventsThird },
    },
    keystroke: { ...stats(keystrokes), eventsSynchronous: syncKeystrokes === WARMUP + keystrokes.length },
    move: full ? stats(moves) : null,
    exportSnapshot: { ms: exportMs, bytes: exported.byteLength },
    heap: { opened: heapOpened, end: heapEnd },
    correct: { open: openDigestOk, mergeFirst: mergeFirstOk, mergeWarm: mergeWarmOk, mergeConcurrent: mergeConcurrentOk, moves: movesOk },
  }
}

export type BenchResult = Awaited<ReturnType<typeof runBench>>
