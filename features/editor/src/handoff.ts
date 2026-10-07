import type { EditorView } from "@codemirror/view"
import { Schema } from "effect"
import { CursorPlacement } from "./host.ts"
import { keystrokeOf, press, type Keystroke } from "./typing.ts"

export const Arrival = Schema.TaggedUnion({
  Caret: { cursor: CursorPlacement },
  Merged: { tail: Schema.String },
})
export type Arrival = typeof Arrival.Type

export interface Handoff {
  readonly hold: (view: EditorView) => void
  readonly settle: (view: EditorView) => void
  readonly carry: (arrival: Arrival) => void
  readonly take: () => Arrival | null
  readonly arrive: (view: EditorView) => void
  readonly replaying: () => boolean
}

type Held =
  | { readonly _tag: "Key"; readonly stroke: Keystroke }
  | { readonly _tag: "Paste"; readonly text: string }

const isPasteKey = (stroke: Keystroke) =>
  stroke.key.toLowerCase() === "v" && (stroke.ctrlKey || stroke.metaKey) && !stroke.altKey

const pasteInto = (view: EditorView, text: string) => {
  const clipboardData = new DataTransfer()
  clipboardData.setData("text/plain", text)
  view.contentDOM.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
  )
}

export const createHandoff = (): Handoff => {
  let held: Array<Held> | null = null
  let holder: EditorView | null = null
  let carried: Arrival | null = null
  let delivering = false

  const capture = (event: KeyboardEvent) => {
    const stroke = keystrokeOf(event)
    if (held === null || stroke === null || isPasteKey(stroke)) return
    held.push({ _tag: "Key", stroke })
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const capturePaste = (event: ClipboardEvent) => {
    if (held === null) return
    held.push({ _tag: "Paste", text: event.clipboardData?.getData("text/plain") ?? "" })
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const release = (): ReadonlyArray<Held> => {
    window.removeEventListener("keydown", capture, true)
    window.removeEventListener("paste", capturePaste, true)
    window.removeEventListener("pointerdown", release, true)
    const keys = held ?? []
    held = null
    holder = null
    return keys
  }

  const deliver = (view: EditorView) => {
    const keys = release()
    delivering = true
    try {
      for (const [index, item] of keys.entries()) {
        if (item._tag === "Key") press(view, item.stroke)
        else pasteInto(view, item.text)
        if (held !== null) {
          held.unshift(...keys.slice(index + 1))
          return
        }
      }
    } finally {
      delivering = false
    }
  }

  const forget = () => {
    carried = null
  }

  return {
    hold: (view) => {
      holder = view
      if (held !== null) return
      held = []
      window.addEventListener("keydown", capture, true)
      window.addEventListener("paste", capturePaste, true)
      window.addEventListener("pointerdown", release, true)
    },
    settle: (view) => {
      if (held !== null && holder === view) deliver(view)
    },
    carry: (arrival) => {
      carried = arrival
      window.addEventListener("keydown", forget, { capture: true, once: true })
      window.addEventListener("pointerdown", forget, { capture: true, once: true })
    },
    take: () => {
      const arrival = carried
      carried = null
      return arrival
    },
    arrive: (view) => {
      if (held !== null) deliver(view)
    },
    replaying: () => delivering,
  }
}
