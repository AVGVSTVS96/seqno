import { editingBlock } from "@seqno/editor"
import type { Host } from "./host.ts"

export const cursorPosition = () => {
  const live = editingBlock()
  if (live === null) return null
  const pos = live.view.state.selection.main.head
  const coords = live.view.coordsAtPos(pos)
  const rect = live.view.dom.getBoundingClientRect().toJSON()
  return coords === null
    ? null
    : {
        pos,
        left: coords.left - rect.left,
        top: coords.top - rect.top,
        height: coords.bottom - coords.top,
        rect,
      }
}

export const watchSelection = (host: Host) => {
  let last = ""
  const settle = (point: { readonly x: number; readonly y: number } | null) => {
    const live = editingBlock()
    if (live === null) return
    const { from, to, head } = live.view.state.selection.main
    const key = `${live.blockId}:${from}:${to}`
    if (from === to || key === last) {
      if (from === to) last = ""
      return
    }
    last = key
    const end = live.view.coordsAtPos(head)
    host.hook("editor", "input_selection_end", {
      caret: cursorPosition(),
      start: from,
      end: to,
      text: live.view.state.sliceDoc(from, to),
      point: point ?? (end === null ? {} : { x: end.left, y: end.bottom }),
    })
  }
  document.addEventListener("mouseup", (event) =>
    requestAnimationFrame(() => settle({ x: event.clientX, y: event.clientY })),
  )
  document.addEventListener("keyup", () => requestAnimationFrame(() => settle(null)))
}
