import { Context, Effect, Layer, Option } from "effect"
import { Graph, PeerId, type GraphSource } from "../graph.ts"
import { graphV2Layer } from "./graph.ts"
import { dayIds } from "./layout.ts"

export interface Compared {
  readonly pages: number
  readonly blocks: number
  readonly different: ReadonlyArray<string>
}

const reader = PeerId.make("1")

const opened = <E, R>(
  layer: (source: GraphSource) => Layer.Layer<Graph, E, R>,
  files: ReadonlyArray<Uint8Array>,
) =>
  Effect.map(
    Layer.build(layer({ peer: reader, snapshot: Option.none(), updates: files })),
    (context) => Context.get(context, Graph),
  )

export const compareConverted = (
  oneTree: ReadonlyArray<Uint8Array>,
  treePerPage: ReadonlyArray<Uint8Array>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const before = yield* opened(Graph.layer, oneTree)
      const after = yield* opened(graphV2Layer, treePerPage)
      const pages = yield* before.pages
      const ids = dayIds(pages)
      const left = new Map((yield* after.pages).map((page) => [page.id, page]))
      const different: Array<string> = []
      let blocks = 0
      for (const page of pages) {
        const id = ids.get(page.id) ?? page.id
        const events = yield* before.pageEvents(page.id)
        blocks += events.length - 1
        const expected = JSON.stringify(events).replaceAll(page.id, id)
        if (!left.delete(id) || expected !== JSON.stringify(yield* after.pageEvents(id))) {
          different.push(page.title)
        }
      }
      for (const page of left.values()) different.push(page.title)
      const compared: Compared = { pages: pages.length, blocks, different: different.toSorted() }
      return compared
    }),
  )
