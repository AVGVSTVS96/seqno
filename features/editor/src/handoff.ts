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
}

export const createHandoff = (): Handoff => {
  let held: Array<Keystroke> | null = null
  let holder: EditorView | null = null
  let carried: Arrival | null = null

  const capture = (event: KeyboardEvent) => {
    const stroke = keystrokeOf(event)
    if (held === null || stroke === null) return
    held.push(stroke)
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const release = (): ReadonlyArray<Keystroke> => {
    window.removeEventListener("keydown", capture, true)
    window.removeEventListener("pointerdown", release, true)
    const keys = held ?? []
    held = null
    holder = null
    return keys
  }

  const deliver = (view: EditorView) => {
    const keys = release()
    for (const [index, stroke] of keys.entries()) {
      press(view, stroke)
      if (held !== null) {
        held.unshift(...keys.slice(index + 1))
        return
      }
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
  }
}
