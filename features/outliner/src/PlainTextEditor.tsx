import { useRef, type KeyboardEvent } from "react"
import type { EditorIntent, EditorSlotProps } from "./slot.ts"

const diff = (before: string, after: string) => {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++
  }
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

const intentFor = (event: KeyboardEvent<HTMLTextAreaElement>): EditorIntent | null => {
  const { selectionStart, selectionEnd, value } = event.currentTarget
  const collapsed = selectionStart === selectionEnd
  if (event.nativeEvent.isComposing) return null
  if (event.key === "Enter" && !event.shiftKey) return { _tag: "Split", at: selectionStart }
  if (event.key === "Tab") return { _tag: event.shiftKey ? "Outdent" : "Indent" }
  if (event.key === "Escape") return { _tag: "Exit" }
  if (!collapsed) return null
  if (event.key === "Backspace" && selectionStart === 0) return { _tag: "MergeWithPrevious" }
  if (event.key === "ArrowUp" && !value.slice(0, selectionStart).includes("\n")) {
    return { _tag: "FocusPrevious" }
  }
  if (event.key === "ArrowDown" && !value.slice(selectionEnd).includes("\n")) {
    return { _tag: "FocusNext" }
  }
  return null
}

export const PlainTextEditor = ({ block, caret, dispatch, onIntent }: EditorSlotProps) => {
  const synced = useRef(block.text)

  const mount = (element: HTMLTextAreaElement | null) => {
    element?.focus()
    element?.setSelectionRange(caret, caret)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const intent = intentFor(event)
    if (intent !== null) {
      event.preventDefault()
      onIntent(intent)
    }
  }

  return (
    <textarea
      ref={mount}
      className="seqno-plain-editor"
      aria-label="Block text"
      defaultValue={block.text}
      rows={1}
      onKeyDown={onKeyDown}
      onInput={(event) => {
        const next = event.currentTarget.value
        const { from, to, insert } = diff(synced.current, next)
        synced.current = next
        dispatch({ _tag: "EditText", blockId: block.id, from, to, insert })
      }}
    />
  )
}
