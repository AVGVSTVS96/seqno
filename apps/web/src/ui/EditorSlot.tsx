import { RegistryContext } from "@effect/atom-react"
import { useRouter } from "@tanstack/react-router"
import { Effect, Match, Option, Schema, Stream } from "effect"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { useContext } from "react"
import { BlockId, type Block, type Command } from "@seqno/domain"
import {
  BlockEditor,
  createHandoff,
  EditorAction,
  LinkTarget,
  type EditorHost,
} from "@seqno/editor"
import { blockAtom, pageTreeAtom, type EditorIntent, type EditorSlotProps } from "@seqno/outliner"
import { pages } from "../atoms.ts"
import { referencedOnly } from "./pages/atoms.ts"
import { useNavigateTo } from "./pages/navigation.ts"
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

const blockIdOf = Schema.decodeUnknownOption(BlockId)

export const EditorSlot = ({ block, caret, dispatch, onIntent }: EditorSlotProps) => {
  const registry = useContext(RegistryContext)
  const router = useRouter()
  const navigateTo = useNavigateTo()
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

  const zoomOut = () =>
    Option.match(blockIdOf(router.state.location.search.zoom), {
      onNone: () => undefined,
      onSome: (zoom) =>
        navigateTo({
          _tag: "Zoom",
          pageId: block.pageId,
          blockId: Option.match(latest(), {
            onNone: () => null,
            onSome: (tree) => tree.blocks.find((found) => found.id === zoom)?.parentId ?? null,
          }),
        }),
    })

  const openBlock = (blockId: BlockId) =>
    void Effect.runPromise(
      AtomRegistry.getResult(registry, blockAtom(blockId)).pipe(
        Effect.map((found) => navigateTo({ _tag: "Zoom", pageId: found.pageId, blockId })),
        Effect.ignore,
      ),
    )

  const open = (target: LinkTarget, sidebar: boolean) =>
    LinkTarget.match(target, {
      Url: ({ url }) => void window.open(url, "_blank", "noopener"),
      Page: ({ name }) => navigateTo({ _tag: sidebar ? "SidebarPage" : "Page", name }),
      Block: ({ uuid }) =>
        Option.match(blockIdOf(uuid), {
          onNone: () => undefined,
          onSome: (blockId) =>
            sidebar ? navigateTo({ _tag: "SidebarBlock", blockId }) : openBlock(blockId),
        }),
    })

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
      ZoomIn: () => navigateTo({ _tag: "Zoom", pageId: block.pageId, blockId: block.id }),
      ZoomOut: zoomOut,
      Open: ({ target, sidebar }) => open(target, sidebar),
    }),
    searchPages: () =>
      AtomRegistry.getResult(registry, pages).pipe(
        Effect.orElseSucceed(() => []),
        Effect.map((real) => [...real, ...registry.get(referencedOnly)]),
      ),
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
