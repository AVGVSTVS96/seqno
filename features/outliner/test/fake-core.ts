import { Effect, Layer, Stream, SubscriptionRef } from "effect"
import { RpcTest } from "effect/rpc"
import { Block, BlockId, Command, PageId, type GraphEvent, type Page } from "@seqno/domain"
import { BlockNotFound, CoreClient, CoreRpcs, type PageTree } from "@seqno/rpc"

export const pageId = PageId.make("01920000-0000-7000-8000-0000000000aa")

export const page: Page = { id: pageId, name: "inbox", title: "Inbox", journalDay: null, props: {} }

export const id = (n: number) =>
  BlockId.make(`01920000-0000-7000-8000-${n.toString().padStart(12, "0")}`)

export const block = (n: number, text: string, parent: number | null = null): Block => ({
  id: id(n),
  pageId,
  parentId: parent === null ? null : id(parent),
  text,
  collapsed: false,
  props: {},
})

type Applied = readonly [ReadonlyArray<GraphEvent>, PageTree]

const upserted = (changed: Block): GraphEvent => ({
  _tag: "BlockUpserted",
  block: changed,
  createdAt: 1,
  updatedAt: 1,
})

const replace = (tree: PageTree, next: Block): Applied => [
  [upserted(next)],
  { ...tree, blocks: tree.blocks.map((b) => (b.id === next.id ? next : b)) },
]

const apply = (tree: PageTree, command: Command, nextId: number): Applied => {
  const find = (blockId: BlockId) => tree.blocks.find((b) => b.id === blockId)
  return Command.match(command, {
    EditText: ({ blockId, from, to, insert }): Applied => {
      const target = find(blockId)
      return target === undefined
        ? [[], tree]
        : replace(tree, {
            ...target,
            text: target.text.slice(0, from) + insert + target.text.slice(to),
          })
    },
    SplitBlock: ({ blockId, at }): Applied => {
      const target = find(blockId)
      if (target === undefined) return [[], tree]
      const kept = { ...target, text: target.text.slice(0, at) }
      const created = { ...target, id: id(nextId), text: target.text.slice(at) }
      const blocks = tree.blocks.flatMap((b) => (b.id === blockId ? [kept, created] : [b]))
      return [[upserted(kept), upserted(created)], { ...tree, blocks }]
    },
    SetCollapsed: ({ blockId, collapsed }): Applied => {
      const target = find(blockId)
      return target === undefined ? [[], tree] : replace(tree, { ...target, collapsed })
    },
    Indent: ({ blockIds }): Applied => {
      const target = find(blockIds[0])
      const siblings = tree.blocks.filter((b) => b.parentId === target?.parentId)
      const previous = siblings[siblings.findIndex((b) => b.id === target?.id) - 1]
      return target === undefined || previous === undefined
        ? [[], tree]
        : replace(tree, { ...target, parentId: previous.id })
    },
    CreatePage: (): Applied => [[], tree],
    RenamePage: (): Applied => [[], tree],
    DeletePage: (): Applied => [[], tree],
    InsertBlocks: (): Applied => [[], tree],
    InsertBlock: (): Applied => [[], tree],
    MergeWithPrevious: (): Applied => [[], tree],
    Outdent: (): Applied => [[], tree],
    MoveBlocks: (): Applied => [[], tree],
    DeleteBlocks: (): Applied => [[], tree],
    SetProperty: (): Applied => [[], tree],
    Undo: (): Applied => [[], tree],
    Redo: (): Applied => [[], tree],
  })
}

export const fakeCore = (blocks: ReadonlyArray<Block>) => {
  const commands: Array<Command> = []
  const handlers = CoreRpcs.toLayer(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<PageTree>({ page, blocks })
      return CoreRpcs.of({
        OpenGraph: ({ graph }) => Effect.succeed({ graph, pages: [page] }),
        GetPages: () => Effect.succeed([page]),
        GetPage: () => SubscriptionRef.get(state),
        GetBlock: ({ blockId }) =>
          Effect.flatMap(SubscriptionRef.get(state), (tree) => {
            const found = tree.blocks.find((b) => b.id === blockId)
            return found === undefined
              ? Effect.fail(new BlockNotFound({ blockId }))
              : Effect.succeed(found)
          }),
        WatchPage: () => SubscriptionRef.changes(state),
        WatchQuery: () => Stream.empty,
        Search: () => Effect.succeed({ pages: [], blocks: [] }),
        Dispatch: ({ command }) => {
          commands.push(command)
          return SubscriptionRef.modify(state, (tree) =>
            apply(tree, command, 1000 + commands.length),
          )
        },
      })
    }),
  )
  return {
    commands,
    layer: Layer.effect(CoreClient)(RpcTest.makeClient(CoreRpcs)).pipe(Layer.provide(handlers)),
  }
}
