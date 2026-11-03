import { EditorView } from "@codemirror/view"
import { insertAsset } from "@seqno/syntax"
import { minimalChange } from "./edits.ts"
import type { EditorHost } from "./host.ts"

export const insertAssets = async (
  view: EditorView,
  host: EditorHost,
  files: ReadonlyArray<File>,
) => {
  if (files.length === 0) return
  const links = await host.saveAssets(files)
  if (links.length === 0 || !view.dom.isConnected) return
  const text = view.state.doc.toString()
  const { from, to } = view.state.selection.main
  const next = insertAsset(text, from, to, links.join(" "))
  view.dispatch({
    changes: minimalChange(text, next.text),
    selection: { anchor: next.caret },
    userEvent: "input.paste",
    scrollIntoView: true,
  })
}

export const pickAssets = (view: EditorView, host: EditorHost) => {
  const input = view.dom.ownerDocument.createElement("input")
  input.type = "file"
  input.addEventListener("change", () => void insertAssets(view, host, [...(input.files ?? [])]), {
    once: true,
  })
  input.click()
}

const filesOf = (transfer: DataTransfer | null) => [...(transfer?.files ?? [])]

export const assetDrops = (host: EditorHost) =>
  EditorView.domEventHandlers({
    paste: (event, view) => {
      const clipboard = event.clipboardData
      const files = filesOf(clipboard)
      const blank =
        (clipboard?.getData("text/plain") ?? "").trim() === "" &&
        (clipboard?.getData("text/html") ?? "").trim() === ""
      if (files.length === 0 || !blank) return false
      event.preventDefault()
      void insertAssets(view, host, files.slice(0, 1))
      return true
    },
    drop: (event, view) => {
      const files = filesOf(event.dataTransfer)
      if (files.length === 0) return false
      event.preventDefault()
      void insertAssets(view, host, files)
      return true
    },
  })
