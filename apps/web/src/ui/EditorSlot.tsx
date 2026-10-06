import { RegistryContext } from "@effect/atom-react"
import { Effect, Match, Option, Stream } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { useContext } from "react"
import { normalizePageName, type Command } from "@seqno/domain"
import { BlockEditor, Navigation, type EditorHost } from "@seqno/editor"
import { pageTreeAtom, type EditorIntent, type EditorSlotProps } from "@seqno/outliner"
import { pages, search } from "../atoms.ts"

const intentOf = Match.type<Command>().pipe(
  Match.tags({
    SplitBlock: ({ at }): EditorIntent => ({ _tag: "Split", at }),
    MergeWithPrevious: (): EditorIntent => ({ _tag: "MergeWithPrevious" }),
    Indent: (): EditorIntent => ({ _tag: "Indent" }),
    Outdent: (): EditorIntent => ({ _tag: "Outdent" }),
  }),
  Match.option,
)

export const EditorSlot = ({ block, caret, dispatch, onIntent }: EditorSlotProps) => {
  const registry = useContext(RegistryContext)
  const host: EditorHost = {
    dispatch: (command) =>
      Option.match(intentOf(command), { onSome: onIntent, onNone: () => dispatch(command) }),
    navigate: Navigation.match({
      ToPrevious: () => onIntent({ _tag: "FocusPrevious" }),
      ToNext: () => onIntent({ _tag: "FocusNext" }),
    }),
    searchPages: (query) =>
      AtomRegistry.getResult(registry, pages).pipe(
        Effect.map((all) => all.filter((page) => page.name.includes(normalizePageName(query)))),
        Effect.orElseSucceed(() => []),
      ),
    searchBlocks: (query) =>
      AtomRegistry.getResult(registry, search(query)).pipe(
        Effect.map((result) => result.blocks),
        Effect.orElseSucceed(() => []),
      ),
  }
  const textUpdates = AtomRegistry.toStreamResult(registry, pageTreeAtom(block.pageId)).pipe(
    Stream.map((tree) => tree.blocks.find((candidate) => candidate.id === block.id)?.text),
    Stream.filter((text) => text !== undefined),
    Stream.changes,
    Stream.ignore,
  )
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") onIntent({ _tag: "Exit" })
      }}
    >
      <BlockEditor
        blockId={block.id}
        text={block.text}
        cursor={{ _tag: "Offset", offset: caret }}
        textUpdates={textUpdates}
        host={host}
      />
    </div>
  )
}
