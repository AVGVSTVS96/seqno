import { names, type Table } from "./names.ts"

const headingPrefix = /^(#{1,6}) /

const editorStyle = (content: string, heading: string | undefined) => {
  const level = Number(heading)
  if (Number.isInteger(level) && level >= 1 && level <= 6) return `h${level}`
  const prefix = headingPrefix.exec(content)?.[1]
  if (prefix !== undefined) return `h${prefix.length}`
  return content.startsWith("---\n") && content.endsWith("\n---")
    ? "page-properties"
    : "normal-block"
}

export interface EditorParts {
  readonly "seqno-editor-wrapper": readonly [string]
  readonly "seqno-editor": readonly []
  readonly "seqno-editor-content": readonly [string, string, string | undefined]
  readonly "sq-popup-host": readonly []
  readonly "sq-popup": readonly []
  readonly "sq-popup-row": readonly [boolean]
  readonly "sq-popup-group": readonly []
  readonly "sq-date": readonly []
  readonly "sq-date-calendar": readonly []
  readonly "sq-date-turn-cell": readonly ["prev" | "next"]
  readonly "sq-date-month": readonly []
  readonly "sq-date-weekday": readonly []
  readonly "sq-date-day": readonly [{ readonly inMonth: boolean; readonly chosen: boolean }]
}

export const editorParts: Table<EditorParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2432
  "seqno-editor-wrapper": (blockId) => ({
    className: "editor-wrapper",
    id: `editor-edit-block-${blockId}`,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/editor.cljs#L656
  "seqno-editor": () => ({ className: "editor-inner block-editor" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/editor.cljs#L509-L540
  "seqno-editor-content": (blockId, content, heading) => ({
    className: names(
      content.length > 1000 || content.includes("\n") ? "multiline-block" : "uniline-block",
      editorStyle(content, heading),
    ),
    id: `edit-block-${blockId}`,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/editor.cljs#L447
  "sq-popup-host": () => ({ className: "absolute-modal" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L530
  "sq-popup": () => ({ className: "", id: "ui__ac-inner" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L540-L545
  "sq-popup-row": (chosen) => ({ className: names("menu-link", chosen && "chosen") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L554
  "sq-popup-group": () => ({ className: "ui__ac-group-name" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/datetime.cljs#L154
  "sq-date": () => ({ className: "", id: "date-time-picker" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui/date_picker.cljs#L81-L84
  "sq-date-calendar": () => ({
    className: "rc-datepicker-wrapper rc-datepicker datepicker noselect",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui/date_picker.cljs#L103-L110
  "sq-date-turn-cell": (side) => ({ className: `${side} available selectable` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui/date_picker.cljs#L106
  "sq-date-month": () => ({ className: "month" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui/date_picker.cljs#L114
  "sq-date-weekday": () => ({ className: "day-enabled" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui/date_picker.cljs#L127-L134
  "sq-date-day": ({ inMonth, chosen }) => ({
    className: names("available", !inMonth && "off", chosen && "active start-date end-date"),
  }),
}
