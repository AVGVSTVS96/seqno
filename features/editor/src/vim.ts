import { Facet, Prec, type Extension } from "@codemirror/state"
import { drawSelection, EditorView } from "@codemirror/view"
import { getCM, Vim, vim } from "@replit/codemirror-vim"
import type { Handoff } from "./handoff.ts"
import type { EditorAction } from "./host.ts"

export interface VimBlock {
  readonly act: (action: EditorAction) => void
  readonly history: (step: "Undo" | "Redo") => void
  readonly handoff: Handoff
}

const blockOf = Facet.define<VimBlock, VimBlock | null>({
  combine: (blocks) => blocks[0] ?? null,
})

for (const [keys, step] of [
  ["u", "Undo"],
  ["<C-r>", "Redo"],
] as const) {
  Vim.defineAction(`seqno${step}`, (cm, { repeat }) => {
    const block = cm.cm6.state.facet(blockOf)
    for (let count = 0; count < repeat; count++) block?.history(step)
  })
  Vim.mapCommand(keys, "action", `seqno${step}`, {}, { context: "normal" })
}

export const hasVim = (view: EditorView) => getCM(view) !== null

const resting = (view: EditorView): boolean => {
  const state = getCM(view)?.state.vim
  if (state === null || state === undefined || state.insertMode || state.visualMode) return false
  const input = state.inputState
  return (
    input.keyBuffer.length === 0 &&
    input.prefixRepeat.length === 0 &&
    (input.operator ?? null) === null &&
    (input.registerName ?? null) === null
  )
}

const keyOf = (event: KeyboardEvent) =>
  event.ctrlKey || event.metaKey || event.altKey
    ? null
    : event.key === "ArrowDown"
      ? "j"
      : event.key === "ArrowUp"
        ? "k"
        : event.key

const atEdge = (view: EditorView, block: VimBlock, key: string): boolean => {
  const { doc, selection } = view.state
  const line = doc.lineAt(selection.main.head)
  const first = line.number === 1
  const last = line.number === doc.lines
  if (key === "Escape") block.act({ _tag: "Exit" })
  else if ((key === "j" && last) || (key === "k" && first)) {
    const column = selection.main.head - line.from
    block.handoff.carry({
      _tag: "Caret",
      cursor: key === "j" ? { _tag: "FirstLine", column } : { _tag: "LastLine", column },
      vim: "Normal",
    })
    block.act({ _tag: key === "j" ? "FocusNext" : "FocusPrevious" })
  } else if ((key === "o" && last) || (key === "O" && first)) {
    block.handoff.hold(view)
    block.act({ _tag: "NewBlock", below: key === "o" })
  } else return false
  return true
}

export const vimMode = (block: VimBlock): Extension => [
  blockOf.of(block),
  vim(),
  drawSelection(),
  Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        const key = keyOf(event)
        if (key === null || !resting(view) || !atEdge(view, block, key)) return false
        event.preventDefault()
        return true
      },
    }),
  ),
]

export const enterInsert = (view: EditorView) => {
  const cm = getCM(view)
  if (cm !== null) Vim.handleKey(cm, "i", "mapping")
}
