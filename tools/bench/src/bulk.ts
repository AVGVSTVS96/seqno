import { Effect } from "effect"
import type { Block, BlockId, Command } from "@seqno/domain"
import type { Graph } from "@seqno/graph"
import { emptyGraph } from "./graph.ts"
import { importFiles, longPageFiles } from "./years.ts"

const longPage = (blocks: number) =>
  Effect.gen(function* () {
    const imported = yield* importFiles(longPageFiles(blocks))
    const graph = yield* emptyGraph("50")
    yield* graph.load(imported.pages)
    return yield* graph.snapshot
  })

const timedOn = (
  snapshot: Uint8Array,
  commands: (blocks: ReadonlyArray<Block>) => ReadonlyArray<Command>,
  then: (graph: Graph["Service"]) => Effect.Effect<unknown> = () => Effect.void,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const graph = yield* emptyGraph("51")
      yield* graph.restore([snapshot])
      const page = (yield* graph.pages)[0]
      if (page === undefined) return yield* Effect.die("the long page did not load")
      const { blocks } = yield* graph.page(page.id)
      const started = performance.now()
      yield* Effect.orDie(graph.dispatchAll(commands(blocks)))
      const commandMs = performance.now() - started
      yield* then(graph)
      return [commandMs, performance.now() - started - commandMs] as const
    }),
  )

const ids = (blocks: ReadonlyArray<Block>): readonly [BlockId, ...Array<BlockId>] => {
  const [first, ...rest] = blocks.map((block) => block.id)
  if (first === undefined) throw new Error("the long page has too few blocks")
  return [first, ...rest]
}

export const bulkOnLongPage = (blocks: number, selected: number) =>
  Effect.gen(function* () {
    const snapshot = yield* longPage(blocks)
    const middle = (all: ReadonlyArray<Block>) => ids(all.slice(blocks / 4, blocks / 4 + selected))
    const [deleteMs, undoMs] = yield* timedOn(
      snapshot,
      (all) => [{ _tag: "DeleteBlocks", blockIds: middle(all) }],
      (graph) => Effect.orDie(graph.dispatch({ _tag: "Undo" })),
    )
    const [moveMs] = yield* timedOn(snapshot, (all) => [
      { _tag: "MoveBlocks", blockIds: middle(all), parentId: null },
    ])
    const [indentMs] = yield* timedOn(snapshot, (all) => [
      {
        _tag: "Indent",
        blockIds: ids(all.filter((block) => block.parentId === null).slice(1, selected + 1)),
      },
    ])
    return { deleteMs, undoMs, moveMs, indentMs }
  })
