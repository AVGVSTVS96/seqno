import { useAtomSet } from "@effect/atom-react"
import { Option } from "effect"
import { useRef, type KeyboardEvent } from "react"
import type { Block, BlockId } from "@seqno/domain"
import { dispatch, focusedBlock } from "../atoms.ts"
import { textEdit } from "../text-edit.ts"

export const EditorPlaceholder = ({ block }: { readonly block: Block }) => {
  const sent = useRef(block.text)
  const run = useAtomSet(dispatch)
  const runAndWait = useAtomSet(dispatch, { mode: "promise" })
  const focus = useAtomSet(focusedBlock)
  const insertAfter = () =>
    runAndWait({
      _tag: "InsertBlock",
      pageId: block.pageId,
      parentId: block.parentId,
      after: block.id,
      text: "",
    }).then((events) =>
      events.forEach((event) => {
        if (event._tag === "BlockUpserted") {
          focus(Option.some<BlockId>(event.block.id))
        }
      }),
    )
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      focus(Option.none())
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void insertAfter()
    }
  }
  return (
    <textarea
      className="editor"
      aria-label="Block editor"
      autoFocus
      rows={Math.max(1, block.text.split("\n").length)}
      defaultValue={block.text}
      onKeyDown={onKeyDown}
      onBlur={() => focus(Option.none())}
      onChange={(event) => {
        const edit = textEdit(sent.current, event.currentTarget.value)
        sent.current = event.currentTarget.value
        run({ _tag: "EditText", blockId: block.id, ...edit })
      }}
    />
  )
}
