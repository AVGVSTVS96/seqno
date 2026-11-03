import { names, type Table } from "./names.ts"

export interface EditorParts {
  readonly "seqno-editor-wrapper": readonly [string]
  readonly "seqno-editor": readonly []
  readonly "seqno-editor-content": readonly [string]
  readonly "sq-popup-host": readonly []
  readonly "sq-popup": readonly []
  readonly "sq-popup-row": readonly [boolean]
  readonly "sq-popup-group": readonly []
  readonly "sq-date": readonly []
}

export const editorParts: Table<EditorParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2432
  "seqno-editor-wrapper": (blockId) => ({
    className: "editor-wrapper",
    id: `editor-edit-block-${blockId}`,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/editor.cljs#L656
  "seqno-editor": () => ({ className: "editor-inner block-editor" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/editor.cljs#L535-L540
  "seqno-editor-content": (blockId) => ({ className: "normal-block", id: `edit-block-${blockId}` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/editor.cljs#L447
  "sq-popup-host": () => ({ className: "absolute-modal" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L530
  "sq-popup": () => ({ className: "", id: "ui__ac-inner" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L540-L545
  "sq-popup-row": (chosen) => ({ className: names("menu-link", chosen && "chosen") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L554
  "sq-popup-group": () => ({ className: "ui__ac-group-name" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/datetime.cljs#L154
  "sq-date": () => ({ className: "datepicker", id: "date-time-picker" }),
}
