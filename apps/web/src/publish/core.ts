import { Effect, Layer, Stream, SubscriptionRef } from "effect"
import { RpcTest } from "effect/rpc"
import { isBlockRefTo, type Block, type PageId } from "@seqno/domain"
import type { Published, PublishedRows } from "@seqno/export"
import {
  BlockNotFound,
  BlockRefNotFound,
  CommandRejected,
  CoreClient,
  CoreRpcs,
  PageNotFound,
  QueryInvalid,
  type PageTree,
  type QueryResult,
} from "@seqno/rpc"

const blockRef = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi

const readOnly = new CommandRejected({ reason: "This is a published copy of the graph." })

type Trees = ReadonlyMap<PageId, PageTree>

const blocksOf = (trees: Trees) => [...trees.values()].flatMap((tree) => tree.blocks)

const refCounts = (blocks: ReadonlyArray<Block>) => {
  const counts: Record<string, number> = {}
  for (const block of blocks) {
    const targets = new Set(
      [...block.text.matchAll(blockRef)].map((match) => (match[1] ?? "").toLowerCase()),
    )
    for (const target of targets) counts[target] = (counts[target] ?? 0) + 1
  }
  return counts
}

const answer = (trees: Trees, rows: PublishedRows): QueryResult => {
  if (rows._tag === "PageRows")
    return {
      _tag: "PageRows",
      pages: rows.pages.flatMap((id) => {
        const tree = trees.get(id)
        return tree === undefined ? [] : [tree.page]
      }),
    }
  const byId = new Map(blocksOf(trees).map((block) => [block.id, block]))
  return {
    _tag: "BlockRows",
    blocks: rows.blocks.flatMap((id) => {
      const block = byId.get(id)
      return block === undefined ? [] : [block]
    }),
  }
}

const findBlock = (trees: Trees, uuid: string) =>
  blocksOf(trees).find((block) => isBlockRefTo(block, uuid))

export const publishedCore = (data: Published): Layer.Layer<CoreClient> => {
  const handlers = CoreRpcs.toLayer(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<Trees>(
        new Map(data.pages.map(({ page, blocks }) => [page.id, { page, blocks }])),
      )
      const current = SubscriptionRef.get(state)
      const watch = <A>(read: (trees: Trees) => A) =>
        Stream.map(SubscriptionRef.changes(state), read)
      return CoreRpcs.of({
        Attach: () => Stream.never,
        OpenGraph: ({ graph }) => Effect.succeed({ graph, skipped: [] }),
        ForgetGraph: () => Effect.void,
        Dispatch: ({ command }) =>
          command._tag === "SetCollapsed"
            ? SubscriptionRef.modify(state, (trees) => {
                const block = findBlock(trees, command.blockId)
                const tree = block === undefined ? undefined : trees.get(block.pageId)
                if (block === undefined || tree === undefined) return [[], trees]
                const changed = { ...block, collapsed: command.collapsed }
                const next = new Map(trees)
                next.set(block.pageId, {
                  ...tree,
                  blocks: tree.blocks.map((each) => (each.id === block.id ? changed : each)),
                })
                return [
                  [{ _tag: "BlockUpserted", block: changed, createdAt: 0, updatedAt: 0 }],
                  next,
                ]
              })
            : Effect.fail(readOnly),
        DispatchAll: () => Effect.fail(readOnly),
        GetPages: () =>
          Effect.map(current, (trees) => [...trees.values()].map((tree) => tree.page)),
        GetPage: ({ pageId }) =>
          Effect.flatMap(current, (trees) => {
            const tree = trees.get(pageId)
            return tree === undefined
              ? Effect.fail(new PageNotFound({ pageId }))
              : Effect.succeed(tree)
          }),
        ExportPages: () =>
          Effect.map(current, (trees) =>
            [...trees.values()].map((tree) => ({ ...tree, path: "" })),
          ),
        GetBlock: ({ blockId }) =>
          Effect.flatMap(current, (trees) => {
            const block = findBlock(trees, blockId)
            return block === undefined
              ? Effect.fail(new BlockNotFound({ blockId }))
              : Effect.succeed(block)
          }),
        GetBlockByRef: ({ uuid }) =>
          Effect.flatMap(current, (trees) => {
            const block = findBlock(trees, uuid)
            return block === undefined
              ? Effect.fail(new BlockRefNotFound({ uuid }))
              : Effect.succeed(block)
          }),
        WatchPage: ({ pageId }) =>
          Stream.flatMap(
            watch((trees) => trees.get(pageId)).pipe(Stream.changesWith((a, b) => a === b)),
            (tree) =>
              tree === undefined ? Stream.fail(new PageNotFound({ pageId })) : Stream.make(tree),
          ),
        WatchQuery: ({ query }) => {
          const rows = data.queries[query]
          return rows === undefined
            ? Stream.fail(new QueryInvalid({ query, reason: "Not in the published copy" }))
            : watch((trees) => answer(trees, rows))
        },
        Search: ({ text }) =>
          Effect.map(current, (trees) => {
            const needle = text.trim().toLowerCase()
            const all = [...trees.values()]
            return needle === ""
              ? { pages: [], blocks: [] }
              : {
                  pages: all
                    .map((tree) => tree.page)
                    .filter((page) => page.title.toLowerCase().includes(needle))
                    .slice(0, 10),
                  blocks: blocksOf(trees)
                    .filter((block) => block.text.toLowerCase().includes(needle))
                    .slice(0, 20),
                }
          }),
        WatchBlockRefCounts: () => watch((trees) => refCounts(blocksOf(trees))),
        WatchBlockReferences: ({ uuid }) =>
          watch((trees) =>
            blocksOf(trees).filter((block) =>
              block.text.toLowerCase().includes(`((${uuid.toLowerCase()}))`),
            ),
          ),
        WatchSaveState: () => Stream.make({ _tag: "Saved" }),
        WatchChanges: () => Stream.never,
      })
    }),
  )
  return Layer.effect(CoreClient)(RpcTest.makeClient(CoreRpcs)).pipe(Layer.provide(handlers))
}
