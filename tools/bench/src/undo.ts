import { Effect, Option } from "effect"
import type { Block, Command } from "@seqno/domain"
import type { Graph } from "@seqno/graph"
import { emptyGraph } from "./graph.ts"

const STEPS = 5
const TYPED = "undo"

const opened = (snapshot: Uint8Array, peer: string) =>
  Effect.tap(emptyGraph(peer), (graph) => graph.restore([snapshot]))

const firstBlocks = (graph: Graph["Service"], count: number) =>
  Effect.gen(function* () {
    const pages = yield* graph.pages
    const blocks: Array<Block> = []
    for (let at = 0; at < pages.length && blocks.length < count; at++) {
      const page = pages[(at * 7919) % pages.length]
      if (page === undefined) continue
      const first = (yield* graph.page(page.id)).blocks[0]
      if (first !== undefined) blocks.push(first)
    }
    return blocks
  })

export const undoAfterRemote = (snapshot: Uint8Array, remoteEdits: number) =>
  Effect.gen(function* () {
    const local = yield* opened(snapshot, "40")
    const remote = yield* opened(snapshot, "41")
    const typedInto = (yield* firstBlocks(local, STEPS)).map((block) => block.id)
    for (const blockId of typedInto) {
      for (const [offset, char] of [...TYPED].entries()) {
        yield* local.dispatch({ _tag: "EditText", blockId, from: offset, to: offset, insert: char })
      }
      yield* local.dispatch({ _tag: "SetCollapsed", blockId, collapsed: false })
    }
    for (const block of yield* firstBlocks(remote, remoteEdits)) {
      const command: Command = { _tag: "EditText", blockId: block.id, from: 0, to: 0, insert: "r" }
      yield* remote.dispatch(command)
    }
    const expected = yield* Effect.forEach(typedInto, (id) =>
      Effect.map(remote.block(id), (block) => block.text),
    )
    const update = yield* remote.flush(() => Effect.void)
    yield* local.merge(Option.toArray(Option.map(update, ({ bytes }) => bytes)))
    const times: Array<number> = []
    for (let step = 0; step < STEPS * 2; step++) {
      const started = performance.now()
      yield* local.dispatch({ _tag: "Undo" })
      times.push(performance.now() - started)
    }
    const left = yield* Effect.forEach(typedInto, (id) =>
      Effect.map(local.block(id), (block) => block.text),
    )
    if (left.some((text, at) => text !== expected[at])) {
      return yield* Effect.die("undo did not leave the other device's text as it wrote it")
    }
    return times
  })
