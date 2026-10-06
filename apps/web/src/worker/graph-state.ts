import { Clock, Effect, Option } from "effect"
import type { Crypto } from "effect"
import {
  Command,
  newBlockId,
  newPageId,
  normalizePageName,
  type Block,
  type BlockId,
  type GraphEvent,
  type Page,
  type PageId,
  type Props,
} from "@seqno/domain"
import { CommandRejected, PageNotFound, type PageTree } from "@seqno/rpc"

export interface Entry {
  readonly block: Block
  readonly createdAt: number
}

export interface GraphState {
  readonly graph: string
  readonly pages: ReadonlyArray<Page>
  readonly entries: ReadonlyArray<Entry>
}

export type Applied = readonly [GraphState, ReadonlyArray<GraphEvent>]

type Step = Effect.Effect<Applied, CommandRejected, Crypto.Crypto>

const reject = (reason: string) => Effect.fail(new CommandRejected({ reason }))

const mintBlockId = Effect.orDie(newBlockId)

const mintPageId = Effect.orDie(newPageId)

const notInStub = (command: Command): Step =>
  reject(`${command._tag} is not in the stub core; @seqno/graph implements it`)

const findPage = (state: GraphState, pageId: PageId) =>
  Option.fromNullishOr(state.pages.find((page) => page.id === pageId))

const findEntry = (state: GraphState, blockId: BlockId) =>
  Option.fromNullishOr(state.entries.find((entry) => entry.block.id === blockId))

const subtreeIds = (entries: ReadonlyArray<Entry>, roots: ReadonlySet<BlockId>) =>
  entries.reduce(
    (ids, entry) =>
      entry.block.parentId !== null && ids.has(entry.block.parentId)
        ? new Set([...ids, entry.block.id])
        : ids,
    new Set(roots),
  )

const subtreeEnd = (entries: ReadonlyArray<Entry>, index: number): number => {
  const start = entries[index]
  if (start === undefined) {
    return entries.length
  }
  const inside = subtreeIds(entries.slice(index), new Set([start.block.id]))
  const after = entries.findIndex((entry, at) => at > index && !inside.has(entry.block.id))
  return after === -1 ? entries.length : after
}

const insertionIndex = (
  state: GraphState,
  pageId: PageId,
  parentId: BlockId | null,
  after: BlockId | undefined,
): Option.Option<number> => {
  const { entries } = state
  if (after !== undefined) {
    const at = entries.findIndex(
      (entry) =>
        entry.block.id === after && entry.block.pageId === pageId && entry.block.parentId === parentId,
    )
    return at === -1 ? Option.none() : Option.some(subtreeEnd(entries, at))
  }
  if (parentId !== null) {
    const at = entries.findIndex(
      (entry) => entry.block.id === parentId && entry.block.pageId === pageId,
    )
    return at === -1 ? Option.none() : Option.some(at + 1)
  }
  const first = entries.findIndex((entry) => entry.block.pageId === pageId)
  return Option.some(first === -1 ? entries.length : first)
}

const withProp = (props: Props, key: string, value: string | null): Props =>
  value === null
    ? Object.fromEntries(Object.entries(props).filter(([name]) => name !== key))
    : { ...props, [key]: value }

const upserted = (entry: Entry, updatedAt: number): GraphEvent => ({
  _tag: "BlockUpserted",
  block: entry.block,
  createdAt: entry.createdAt,
  updatedAt,
})

const replaceEntry = (
  state: GraphState,
  blockId: BlockId,
  change: (block: Block) => Option.Option<Block>,
): Step =>
  Option.match(findEntry(state, blockId), {
    onNone: () => reject(`block ${blockId} does not exist`),
    onSome: (found) =>
      Option.match(change(found.block), {
        onNone: () => reject(`the change does not fit block ${blockId}`),
        onSome: (block) =>
          Effect.map(Clock.currentTimeMillis, (now): Applied => {
            const entry = { block, createdAt: found.createdAt }
            return [
              {
                ...state,
                entries: state.entries.map((current) =>
                  current.block.id === blockId ? entry : current,
                ),
              },
              [upserted(entry, now)],
            ]
          }),
      }),
  })

const replacePage = (state: GraphState, page: Page): Applied => [
  { ...state, pages: state.pages.map((current) => (current.id === page.id ? page : current)) },
  [{ _tag: "PageUpserted", page }],
]

const nameTaken = (state: GraphState, name: string, except: PageId | null) =>
  state.pages.some((page) => page.name === name && page.id !== except)

const deleteBlocks = (state: GraphState, roots: ReadonlySet<BlockId>): Applied => {
  const doomed = subtreeIds(state.entries, roots)
  const removed = state.entries.filter((entry) => doomed.has(entry.block.id))
  return [
    { ...state, entries: state.entries.filter((entry) => !doomed.has(entry.block.id)) },
    removed.map(
      (entry): GraphEvent => ({
        _tag: "BlockDeleted",
        blockId: entry.block.id,
        pageId: entry.block.pageId,
      }),
    ),
  ]
}

export const applyCommand = (state: GraphState, command: Command): Step =>
  Command.match(command, {
    CreatePage: ({ title }): Step => {
      const name = normalizePageName(title)
      if (name.length === 0 || nameTaken(state, name, null)) {
        return reject(`a page named "${title}" cannot be created`)
      }
      return Effect.map(mintPageId, (id): Applied => {
        const page: Page = { id, name, title: title.trim(), journalDay: null, props: {} }
        return [{ ...state, pages: [...state.pages, page] }, [{ _tag: "PageUpserted", page }]]
      })
    },
    RenamePage: ({ pageId, title }): Step =>
      Option.match(findPage(state, pageId), {
        onNone: () => reject(`page ${pageId} does not exist`),
        onSome: (page) => {
          const name = normalizePageName(title)
          return name.length === 0 || nameTaken(state, name, pageId)
            ? reject(`a page cannot be renamed to "${title}"`)
            : Effect.succeed(replacePage(state, { ...page, name, title: title.trim() }))
        },
      }),
    DeletePage: ({ pageId }): Step =>
      Option.match(findPage(state, pageId), {
        onNone: () => reject(`page ${pageId} does not exist`),
        onSome: () => {
          const roots = state.entries
            .filter((entry) => entry.block.pageId === pageId)
            .map((entry) => entry.block.id)
          const [next, events] = deleteBlocks(state, new Set(roots))
          return Effect.succeed([
            { ...next, pages: next.pages.filter((page) => page.id !== pageId) },
            [...events, { _tag: "PageDeleted", pageId }],
          ])
        },
      }),
    InsertBlock: ({ pageId, parentId, after, text }): Step =>
      Option.match(Option.flatMap(findPage(state, pageId), () => insertionIndex(state, pageId, parentId, after)), {
        onNone: () => reject("the page, parent or previous sibling does not exist"),
        onSome: (at) =>
          Effect.gen(function* () {
            const id = yield* mintBlockId
            const now = yield* Clock.currentTimeMillis
            const entry: Entry = {
              block: { id, pageId, parentId, text, collapsed: false, props: {} },
              createdAt: now,
            }
            const applied: Applied = [
              { ...state, entries: state.entries.toSpliced(at, 0, entry) },
              [upserted(entry, now)],
            ]
            return applied
          }),
      }),
    EditText: ({ blockId, from, to, insert }): Step =>
      replaceEntry(state, blockId, (block) =>
        from <= to && to <= block.text.length
          ? Option.some({ ...block, text: block.text.slice(0, from) + insert + block.text.slice(to) })
          : Option.none(),
      ),
    SetCollapsed: ({ blockId, collapsed }): Step =>
      replaceEntry(state, blockId, (block) => Option.some({ ...block, collapsed })),
    DeleteBlocks: ({ blockIds }): Step =>
      blockIds.every((id) => Option.isSome(findEntry(state, id)))
        ? Effect.succeed(deleteBlocks(state, new Set(blockIds)))
        : reject("some of the blocks do not exist"),
    SetProperty: ({ target, key, value }): Step =>
      target._tag === "BlockTarget"
        ? replaceEntry(state, target.blockId, (block) =>
            Option.some({ ...block, props: withProp(block.props, key, value) }),
          )
        : Option.match(findPage(state, target.pageId), {
            onNone: () => reject(`page ${target.pageId} does not exist`),
            onSome: (page) =>
              Effect.succeed(replacePage(state, { ...page, props: withProp(page.props, key, value) })),
          }),
    SplitBlock: notInStub,
    MergeWithPrevious: notInStub,
    Indent: notInStub,
    Outdent: notInStub,
    MoveBlocks: notInStub,
    Undo: notInStub,
    Redo: notInStub,
  })

export const pageTree = (state: GraphState, pageId: PageId) =>
  Option.match(findPage(state, pageId), {
    onNone: () => Effect.fail(new PageNotFound({ pageId })),
    onSome: (page): Effect.Effect<PageTree> =>
      Effect.succeed({
        page,
        blocks: state.entries
          .filter((entry) => entry.block.pageId === pageId)
          .map((entry) => entry.block),
      }),
  })

export const searchBlocks = (state: GraphState, text: string): ReadonlyArray<Block> => {
  const needle = text.trim().toLowerCase()
  return needle.length === 0
    ? []
    : state.entries
        .map((entry) => entry.block)
        .filter((block) => block.text.toLowerCase().includes(needle))
}
