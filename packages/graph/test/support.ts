import { Context, Crypto, Effect, Layer, Option } from "effect"
import type { BlockId, GraphEvent, PageId } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { Graph, PeerId } from "@seqno/graph"

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the graph"),
  }),
)

export const openGraph = (
  peer: string,
  files: { readonly snapshot?: Uint8Array; readonly updates?: ReadonlyArray<Uint8Array> } = {},
) =>
  Layer.build(
    Graph.layer({
      peer: PeerId.make(peer),
      snapshot: Option.fromUndefinedOr(files.snapshot),
      updates: files.updates ?? [],
    }).pipe(Layer.provide(WebCrypto)),
  ).pipe(Effect.map((context) => Context.get(context, Graph)))

export const outline = (tree: PageTree): ReadonlyArray<string> => {
  const depth = new Map<string, number>()
  return tree.blocks.map((block) => {
    const level = block.parentId === null ? 0 : (depth.get(block.parentId) ?? 0) + 1
    depth.set(block.id, level)
    return `${"  ".repeat(level)}${block.text}`
  })
}

export const nth = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at ${index}`)
  return item
}

export const createdBlock = (events: ReadonlyArray<GraphEvent>): BlockId => {
  const found = events.find((event) => event._tag === "BlockUpserted")
  if (found?._tag !== "BlockUpserted") throw new Error("no block was created")
  return found.block.id
}

export const createdPage = (events: ReadonlyArray<GraphEvent>): PageId => {
  const found = events.find((event) => event._tag === "PageUpserted")
  if (found?._tag !== "PageUpserted") throw new Error("no page was created")
  return found.page.id
}

export const tags = (events: ReadonlyArray<GraphEvent>): ReadonlyArray<string> =>
  events.map((event) => event._tag)

export const seedPage = (graph: Graph["Service"], title: string, lines: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const pageId = createdPage(yield* graph.dispatch({ _tag: "CreatePage", title }))
    const ids: Array<BlockId> = []
    const parents: Array<BlockId> = []
    const lastChild = new Map<BlockId | null, BlockId>()
    for (const line of lines) {
      const depth = (line.length - line.trimStart().length) / 2
      const parentId = depth === 0 ? null : (parents[depth - 1] ?? null)
      const after = lastChild.get(parentId)
      const id = createdBlock(
        yield* graph.dispatch({
          _tag: "InsertBlock",
          pageId,
          parentId,
          text: line.trimStart(),
          ...(after === undefined ? {} : { after }),
        }),
      )
      ids.push(id)
      parents[depth] = id
      lastChild.set(parentId, id)
    }
    return { pageId, ids }
  })
