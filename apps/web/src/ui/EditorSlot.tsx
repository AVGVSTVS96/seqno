import { RegistryContext } from "@effect/atom-react"
import { Effect, Match, Option, Stream } from "effect"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { useContext } from "react"
import type { Block, BlockId, Command } from "@seqno/domain"
import { BlockEditor, createHandoff, EditorAction, type EditorHost } from "@seqno/editor"
import { pageTreeAtom, type EditorIntent, type EditorSlotProps } from "@seqno/outliner"
import { pages } from "../atoms.ts"
import { searchHits } from "./search/atoms.ts"
import { blockHits } from "./search/model.ts"

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
  const current = () =>
    Option.match(latest(), {
      onNone: () => block,
      onSome: (tree) => tree.blocks.find((candidate) => candidate.id === block.id) ?? block,
    })

  const mergeNext = () => {
    const self = current()
    const siblings = childrenOf(self.parentId)
    const index = siblings.findIndex((sibling) => sibling.id === self.id)
    const next = (self.collapsed ? undefined : childrenOf(self.id)[0]) ?? siblings[index + 1]
    if (index !== -1 && next !== undefined)
      dispatch({ _tag: "MergeWithPrevious", blockId: next.id })
  }

  const host: EditorHost = {
    dispatch: (command) =>
      Option.match(intentOf(command), { onSome: onIntent, onNone: () => dispatch(command) }),
    act: EditorAction.match({
      FocusPrevious: () => onIntent({ _tag: "FocusPrevious" }),
      FocusNext: () => onIntent({ _tag: "FocusNext" }),
      Exit: () => onIntent({ _tag: "Exit" }),
      SelectUp: () => onIntent({ _tag: "SelectUp" }),
      SelectDown: () => onIntent({ _tag: "SelectDown" }),
      MoveUp: () => onIntent({ _tag: "MoveUp" }),
      MoveDown: () => onIntent({ _tag: "MoveDown" }),
      Collapse: () => onIntent({ _tag: "Collapse" }),
      Expand: () => onIntent({ _tag: "Expand" }),
      ToggleCollapse: () => onIntent({ _tag: current().collapsed ? "Expand" : "Collapse" }),
      MergeNext: mergeNext,
    }),
    searchPages: () => AtomRegistry.getResult(registry, pages).pipe(Effect.orElseSucceed(() => [])),
    searchBlocks: (query) =>
      AtomRegistry.getResult(registry, searchHits(query)).pipe(
        Effect.map((hits) =>
          blockHits(
            hits,
            Option.getOrElse(AsyncResult.value(registry.get(pages)), () => []),
          ).map(({ block: found, crumbs }) => ({ block: found, path: crumbs })),
        ),
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
