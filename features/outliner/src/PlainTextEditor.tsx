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
  const mod = event.metaKey || event.ctrlKey
  const firstLine = !value.slice(0, selectionStart).includes("\n")
  const lastLine = !value.slice(selectionEnd).includes("\n")
  if (event.nativeEvent.isComposing) return null
  if (event.key === "Enter" && !event.shiftKey && !mod) return { _tag: "Split", at: selectionStart }
  if (event.key === "Tab") return { _tag: event.shiftKey ? "Outdent" : "Indent" }
  if (event.key === "Escape") return { _tag: "Exit" }
  if (event.key === "ArrowUp" && event.altKey && event.shiftKey) return { _tag: "MoveUp" }
  if (event.key === "ArrowDown" && event.altKey && event.shiftKey) return { _tag: "MoveDown" }
  if (event.key === "ArrowUp" && mod) return { _tag: "Collapse" }
  if (event.key === "ArrowDown" && mod) return { _tag: "Expand" }
  if (event.key === "ArrowUp" && event.shiftKey && firstLine && selectionStart === 0) {
    return { _tag: "SelectUp" }
  }
  if (event.key === "ArrowDown" && event.shiftKey && lastLine && selectionEnd === value.length) {
    return { _tag: "SelectDown" }
  }
  if (!collapsed || event.shiftKey) return null
  if (event.key === "Backspace" && selectionStart === 0) return { _tag: "MergeWithPrevious" }
  if (event.key === "ArrowUp" && firstLine) return { _tag: "FocusPrevious" }
  if (event.key === "ArrowDown" && lastLine) return { _tag: "FocusNext" }
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
      spellCheck={false}
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
