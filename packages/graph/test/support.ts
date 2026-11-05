import { Context, Crypto, Effect, Layer, Option } from "effect"
import type { BlockId, GraphEvent, PageId } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { Graph, PeerId, graphV2Layer } from "@seqno/graph"
import type { GraphSource } from "@seqno/graph"

export const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the graph"),
  }),
)

export const format = process.env["SEQNO_GRAPH"] === "v2" ? "v2" : "v1"

const layerOf = (source: GraphSource) =>
  format === "v2" ? graphV2Layer(source) : Graph.layer(source)

export const openGraphAs = (
  as: "v1" | "v2",
  peer: string,
  files: { readonly snapshot?: Uint8Array; readonly updates?: readonly Uint8Array[] } = {},
) => {
  const source = {
    peer: PeerId.make(peer),
    snapshot: Option.fromUndefinedOr(files.snapshot),
    updates: files.updates ?? [],
  }

  return Layer.build(
    (as === "v2" ? graphV2Layer(source) : Graph.layer(source)).pipe(Layer.provide(WebCrypto)),
  ).pipe(Effect.map((context) => Context.get(context, Graph)))
}

export const openGraph = (
  peer: string,
  files: { readonly snapshot?: Uint8Array; readonly updates?: readonly Uint8Array[] } = {},
) =>
  Layer.build(
    layerOf({
      peer: PeerId.make(peer),
      snapshot: Option.fromUndefinedOr(files.snapshot),
      updates: files.updates ?? [],
    }).pipe(Layer.provide(WebCrypto)),
  ).pipe(Effect.map((context) => Context.get(context, Graph)))

export const outline = (tree: PageTree): readonly string[] => {
  const depth = new Map<string, number>()

  return tree.blocks.map((block) => {
    const level = block.parentId === null ? 0 : (depth.get(block.parentId) ?? 0) + 1
    depth.set(block.id, level)

    return `${"  ".repeat(level)}${block.text}`
  })
}

export const nth = <A>(items: readonly A[], index: number): A => {
  const item = items[index]

  if (item === undefined) {
    throw new Error(`no item at ${index}`)
  }

  return item
}

export const createdBlock = (events: readonly GraphEvent[]): BlockId => {
  const found = events.find((event) => event._tag === "BlockUpserted")

  if (found?._tag !== "BlockUpserted") {
    throw new Error("no block was created")
  }

  return found.block.id
}

export const createdPage = (events: readonly GraphEvent[]): PageId => {
  const found = events.find((event) => event._tag === "PageUpserted")

  if (found?._tag !== "PageUpserted") {
    throw new Error("no page was created")
  }

  return found.page.id
}

export const tags = (events: readonly GraphEvent[]): readonly string[] =>
  events.map((event) => event._tag)

export const seedPage = (graph: Graph["Service"], title: string, lines: readonly string[]) =>
  Effect.gen(function* () {
    const pageId = createdPage(yield* graph.dispatch({ _tag: "CreatePage", title }))
    const ids: BlockId[] = []
    const parents: BlockId[] = []
    const lastChild = new Map<BlockId | null, BlockId>()

    for (const line of lines) {
      const depth = (line.length - line.trimStart().length) / 2
      const parentId = depth === 0 ? null : (parents[depth - 1] ?? null)
      const after = lastChild.get(parentId)

      const insert = { _tag: "InsertBlock", pageId, parentId, text: line.trimStart() } as const

      const id = createdBlock(
        yield* graph.dispatch(after === undefined ? insert : { ...insert, after }),
      )

      ids.push(id)
      parents[depth] = id
      lastChild.set(parentId, id)
    }

    return { pageId, ids }
  })
