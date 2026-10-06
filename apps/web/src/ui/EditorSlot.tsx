import { RegistryContext } from "@effect/atom-react"
import { Effect, Match, Option, Stream } from "effect"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { useContext } from "react"
import type { Block, BlockId, Command } from "@seqno/domain"
import { BlockEditor, createHandoff, EditorAction, type EditorHost } from "@seqno/editor"
import { pageTreeAtom, type EditorIntent, type EditorSlotProps } from "@seqno/outliner"
import { pages, search } from "../atoms.ts"

const handoff = createHandoff()

const intentOf = Match.type<Command>().pipe(
  Match.tags({
    SplitBlock: ({ at }): EditorIntent => ({ _tag: "Split", at }),
    MergeWithPrevious: (): EditorIntent => ({ _tag: "MergeWithPrevious" }),
    Indent: (): EditorIntent => ({ _tag: "Indent" }),
    Outdent: (): EditorIntent => ({ _tag: "Outdent" }),
  }),
  Match.option,
)

const sameBlock = (left: Block, right: Block) =>
  left.text === right.text && left.parentId === right.parentId

const isBlock = (found: Block | undefined): found is Block => found !== undefined

export const EditorSlot = ({ block, caret, dispatch, onIntent }: EditorSlotProps) => {
  const registry = useContext(RegistryContext)
  const latest = () => AsyncResult.value(registry.get(pageTreeAtom(block.pageId)))
  const childrenOf = (parentId: BlockId | null) =>
    Option.match(latest(), {
      onNone: () => [],
      onSome: (tree) => tree.blocks.filter((candidate) => candidate.parentId === parentId),
    })
  const parentId = () =>
    Option.match(latest(), {
      onNone: () => block.parentId,
      onSome: (tree) =>
        tree.blocks.find((candidate) => candidate.id === block.id)?.parentId ?? null,
    })

  const move = (direction: -1 | 1) => {
    const parent = parentId()
    const siblings = childrenOf(parent)
    const index = siblings.findIndex((sibling) => sibling.id === block.id)
    const target = index + direction
    if (index === -1 || target < 0 || target >= siblings.length) return
    const after = siblings[direction === -1 ? index - 2 : index + 1]
    dispatch({
      _tag: "MoveBlocks",
      blockIds: [block.id],
      parentId: parent,
      ...(after === undefined ? {} : { after: after.id }),
    })
  }

  const collapse = (collapsed: boolean) => {
    if (childrenOf(block.id).length > 0)
      dispatch({ _tag: "SetCollapsed", blockId: block.id, collapsed })
  }

  const titles = () =>
    new Map(
      Option.getOrElse(AsyncResult.value(registry.get(pages)), () => []).map((page) => [
        page.id,
        page.title,
      ]),
    )

  const host: EditorHost = {
    dispatch: (command) =>
      Option.match(intentOf(command), { onSome: onIntent, onNone: () => dispatch(command) }),
    act: EditorAction.match({
      FocusPrevious: () => onIntent({ _tag: "FocusPrevious" }),
      FocusNext: () => onIntent({ _tag: "FocusNext" }),
      Exit: () => onIntent({ _tag: "Exit" }),
      MoveUp: () => move(-1),
      MoveDown: () => move(1),
      Collapse: () => collapse(true),
      Expand: () => collapse(false),
    }),
    searchPages: () => AtomRegistry.getResult(registry, pages).pipe(Effect.orElseSucceed(() => [])),
    searchBlocks: (query) =>
      AtomRegistry.getResult(registry, search(query)).pipe(
        Effect.map((result) => {
          const titleOf = titles()
          return result.blocks.map((found) => ({
            block: found,
            path: [titleOf.get(found.pageId) ?? ""],
          }))
        }),
        Effect.orElseSucceed(() => []),
      ),
  }

  const updates = AtomRegistry.toStreamResult(registry, pageTreeAtom(block.pageId)).pipe(
    Stream.map((tree) => tree.blocks.find((candidate) => candidate.id === block.id)),
    Stream.filter(isBlock),
    Stream.changesWith(sameBlock),
    Stream.ignore,
  )

  return (
    <BlockEditor
      block={block}
      cursor={{ _tag: "Offset", offset: caret }}
      updates={updates}
      host={host}
      handoff={handoff}
    />
  )
}
