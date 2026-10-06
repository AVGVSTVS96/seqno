import { LoroDoc, type LoroText, type LoroTreeNode, type TreeID } from "loro-crdt"
import init from "loro-crdt/web/loro_wasm.js"
import wasmUrl from "loro-crdt/web/loro_wasm_bg.wasm?url"
import { createRng, graphDigest, type Edit, type Rng } from "../../shared/fixture/src/index.ts"
import type { FixtureMeta } from "../scripts/prep.ts"
import { applyEdit, loadBlockMap, openSession, toGraph, TREE, type Session } from "./schema.ts"
import { buildIndex } from "./sqlite.ts"
import { summarize } from "./stats.ts"

export type OpenMode = "snapshot" | "snapshotThenUpdates" | "importBatch"
export interface Keystroke { readonly uuid: string; readonly index: number; readonly char: string }
export interface Move { readonly uuid: string; readonly parent: string; readonly index: number }

const now = () => performance.now()
const LOCAL_PEER = 100n
const TYPED = "abcdefghijklmnopqrstuvwxyz "

const fixture = (path: string) => fetch(`/fixture/${path}`)
const fetchBytes = async (path: string) => new Uint8Array(await (await fixture(path)).arrayBuffer())

let memory: WebAssembly.Memory
let meta: FixtureMeta
let session: Session
let moves: { rng: Rng; candidates: TreeID[]; targets: TreeID[] }

const digest = () => graphDigest(toGraph(session.map))
const entry = (uuid: string) => session.map.entries.get(session.map.byUuid.get(uuid)!)!

const isWithin = (id: TreeID, ancestor: TreeID) => {
  for (let at: TreeID | null = id; at !== null; at = session.map.entries.get(at)!.parent) if (at === ancestor) return true
  return false
}

const subtreeSize = (id: TreeID): number =>
  1 + session.map.entries.get(id)!.children.reduce((sum, child) => sum + subtreeSize(child), 0)

const loadFiles = async (withUpdates: boolean) => {
  const t0 = now()
  memory = (await init({ module_or_path: wasmUrl })).memory
  const t1 = now()
  meta = await (await fixture("meta.json")).json()
  const snapshot = await fetchBytes("snapshot.loro")
  const updates = withUpdates ? await Promise.all(meta.updateFiles.map(fetchBytes)) : []
  return { snapshot, updates, wasmInitMs: t1 - t0, fetchMs: now() - t1 }
}

const importFiles = (snapshot: Uint8Array, updates: readonly Uint8Array[], batch: boolean) => {
  const doc = new LoroDoc()
  doc.setPeerId(LOCAL_PEER)
  if (batch) doc.importBatch([snapshot, ...updates])
  else {
    doc.import(snapshot)
    for (const update of updates) doc.import(update)
  }
  return doc
}

const wasmMB = () => Math.round(memory.buffer.byteLength / 1024 / 1024)

const ops = {
  async open(mode: OpenMode) {
    const { snapshot, updates, wasmInitMs, fetchMs } = await loadFiles(mode !== "snapshot")
    const t0 = now()
    const doc = importFiles(snapshot, updates, mode === "importBatch")
    const t1 = now()
    const wasmAfterImportMB = wasmMB()
    session = openSession(doc)
    const t2 = now()
    return {
      wasmInitMs,
      fetchMs,
      files: 1 + updates.length,
      importMs: t1 - t0,
      blockMapMs: t2 - t1,
      openMs: t2 - t0,
      wasmAfterImportMB,
      wasmAfterBlockMapMB: wasmMB(),
      treeNodes: session.map.entries.size,
      digestOk: digest() === (mode === "snapshot" ? meta.graphDigest : meta.afterUpdatesDigest),
    }
  },

  async openFirstPage(pageUuid: string) {
    const { snapshot, updates } = await loadFiles(true)
    const t0 = now()
    const tree = importFiles(snapshot, updates, false).getTree(TREE)
    const t1 = now()
    const pages = tree.roots().map((node) => ({ node, uuid: node.data.get("uuid"), title: node.data.get("title") }))
    const t2 = now()
    const read = (node: LoroTreeNode): { uuid: unknown; text: string }[] =>
      (node.children() ?? []).flatMap((child) => [
        { uuid: child.data.get("uuid"), text: (child.data.get("text") as LoroText).toString() },
        ...read(child),
      ])
    const blocks = read(pages.find((p) => p.uuid === pageUuid)!.node)
    const t3 = now()
    return { importMs: t1 - t0, pageListMs: t2 - t1, pageMs: t3 - t2, firstPageReadyMs: t3 - t0, pages: pages.length, pageBlocks: blocks.length, wasmMB: wasmMB() }
  },

  async merge() {
    const update = await fetchBytes("merge.loro")
    const t0 = now()
    session.doc.import(update)
    const ms = now() - t0
    return { ms, bytes: update.byteLength, digestOk: digest() === meta.afterMergeDigest }
  },

  async localEdits(saveEvery: number) {
    const edits: Edit[] = await (await fixture("local-edits.json")).json()
    const editMs: number[] = []
    const saveMs: number[] = []
    const saveBytes: number[] = []
    let saved = session.doc.oplogVersion()
    const t0 = now()
    for (const [i, edit] of edits.entries()) {
      const started = now()
      applyEdit(session, edit)
      editMs.push(now() - started)
      if ((i + 1) % saveEvery !== 0) continue
      const saveStarted = now()
      const update = session.doc.export({ mode: "update", from: saved })
      saveMs.push(now() - saveStarted)
      saveBytes.push(update.byteLength)
      saved = session.doc.oplogVersion()
    }
    return {
      totalMs: now() - t0,
      perEdit: summarize(editMs),
      batchedSave: { editsPerSave: saveEvery, exportMs: summarize(saveMs), bytes: summarize(saveBytes) },
      digestOk: digest() === meta.afterLocalEditsDigest,
    }
  },

  planKeystrokes({ count, seed }: { count: number; seed: number }): Keystroke[] {
    const rng = createRng(seed)
    const blocks = [...session.map.entries.values()].filter((e) => e.parent !== null)
    return Array.from({ length: count }, () => {
      const block = blocks[rng.int(0, blocks.length - 1)]!
      return { uuid: block.uuid, index: rng.int(0, block.text.length), char: TYPED[rng.int(0, TYPED.length - 1)]! }
    })
  },

  keystroke({ uuid, index, char }: Keystroke) {
    const t0 = now()
    applyEdit(session, { kind: "insertText", block: uuid, index, text: char })
    const workerMs = now() - t0
    return { workerMs, text: entry(uuid).text }
  },

  seedMoves(seed: number) {
    const entries = [...session.map.entries.values()]
    moves = {
      rng: createRng(seed),
      candidates: entries.filter((e) => e.parent !== null && e.children.length > 0).map((e) => e.id),
      targets: entries.map((e) => e.id),
    }
  },

  nextMove(): Move {
    const { rng, candidates, targets } = moves
    for (;;) {
      const block = session.map.entries.get(candidates[rng.int(0, candidates.length - 1)]!)
      const parent = session.map.entries.get(targets[rng.int(0, targets.length - 1)]!)
      if (block === undefined || parent === undefined || block.parent === parent.id || isWithin(parent.id, block.id)) continue
      return { uuid: block.uuid, parent: parent.uuid, index: rng.int(0, parent.children.length) }
    }
  },

  move({ uuid, parent, index }: Move) {
    const t0 = now()
    applyEdit(session, { kind: "moveBlock", block: uuid, parent, index })
    const workerMs = now() - t0
    const moved = entry(uuid)
    return { workerMs, subtreeBlocks: subtreeSize(moved.id), parentOk: moved.parent === session.map.byUuid.get(parent) }
  },

  wasmMemoryBytes: () => memory.buffer.byteLength,

  blockMapMatchesLoro: () => digest() === graphDigest(toGraph(loadBlockMap(session.doc))),

  sizes() {
    const { doc } = session
    const t0 = now()
    const snapshot = doc.export({ mode: "snapshot" })
    const t1 = now()
    const shallow = doc.export({ mode: "shallow-snapshot", frontiers: doc.oplogFrontiers() })
    const t2 = now()
    return { snapshotBytes: snapshot.byteLength, snapshotExportMs: t1 - t0, shallowSnapshotBytes: shallow.byteLength, shallowExportMs: t2 - t1 }
  },

  sqliteIndex: () => buildIndex(session.map),
}

export type Ops = typeof ops

self.onmessage = async ({ data }: MessageEvent<{ id: number; op: keyof Ops; arg: unknown }>) => {
  try {
    postMessage({ id: data.id, ok: await (ops[data.op] as (arg: unknown) => unknown)(data.arg) })
  } catch (error) {
    postMessage({ id: data.id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  }
}
