import { EditorView } from "@codemirror/view"
import type { Block, BlockDraft, BlockId, Command } from "@seqno/domain"
import { isSingleLine, joinProperties, pastedBlocks, type PastedBlock } from "@seqno/syntax"

const nonEmpty = <A>(items: ReadonlyArray<A>): readonly [A, ...Array<A>] | null => {
  const [first, ...rest] = items
  return first === undefined ? null : [first, ...rest]
}

const insert = (
  block: Pick<Block, "pageId">,
  parentId: BlockId | null,
  after: BlockId | undefined,
  drafts: ReadonlyArray<BlockDraft>,
): ReadonlyArray<Command> => {
  const blocks = nonEmpty(drafts)
  return blocks === null
    ? []
    : [
        {
          _tag: "InsertBlocks",
          pageId: block.pageId,
          parentId,
          ...(after === undefined ? {} : { after }),
          blocks,
        },
      ]
}

const url = /^[a-z][a-z\d+.-]*:\/\/\S+$/i

const asText = (block: PastedBlock) => joinProperties(block.text, Object.entries(block.props))

export const pasteOutline = (
  block: Pick<Block, "id" | "pageId">,
  parentOf: () => BlockId | null,
  dispatch: (command: Command) => void,
) =>
  EditorView.domEventHandlers({
    paste: (event, view) => {
      const clipboard = event.clipboardData?.getData("text/plain") ?? ""
      const { from, to } = view.state.selection.main
      if (from !== to && url.test(clipboard.trim())) {
        event.preventDefault()
        const link = `[${view.state.sliceDoc(from, to)}](${clipboard.trim()})`
        view.dispatch({
          changes: { from, to, insert: link },
          selection: { anchor: from + link.length },
          userEvent: "input.paste",
        })
        return true
      }
      const blocks = pastedBlocks(clipboard)
      const [first, ...rest] = blocks ?? []
      if (blocks === null || first === undefined) return false
      event.preventDefault()
      if (isSingleLine(blocks)) {
        view.dispatch(view.state.replaceSelection(first.text), { userEvent: "input.paste" })
        return true
      }
      if (view.state.doc.length > 0) {
        for (const command of insert(block, parentOf(), block.id, blocks)) dispatch(command)
        return true
      }
      const text = asText(first)
      view.dispatch({
        changes: { from: 0, insert: text },
        selection: { anchor: first.text.length },
        userEvent: "input.paste",
      })
      for (const command of [
        ...insert(block, block.id, undefined, first.children),
        ...insert(block, parentOf(), block.id, rest),
      ])
        dispatch(command)
      return true
    },
  })
