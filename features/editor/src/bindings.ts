export interface Binding {
  readonly label: string
  readonly key: string
  readonly mac?: string
}

export const editorBindings = {
  newBlock: { label: "New block", key: "Enter" },
  newLine: { label: "New line in the block", key: "Shift-Enter" },
  indent: { label: "Indent block", key: "Tab" },
  outdent: { label: "Outdent block", key: "Shift-Tab" },
  exit: { label: "Stop editing and select the block", key: "Escape" },
  selectAbove: { label: "Select the block above", key: "Shift-ArrowUp" },
  selectBelow: { label: "Select the block below", key: "Shift-ArrowDown" },
  cycleTask: { label: "Cycle the task marker", key: "Mod-Enter" },
  bold: { label: "Bold", key: "Mod-b" },
  italic: { label: "Italic", key: "Mod-i" },
  highlight: { label: "Highlight", key: "Mod-Shift-h" },
  strike: { label: "Strikethrough", key: "Mod-Shift-s" },
  link: { label: "Insert a link", key: "Mod-l" },
  collapse: { label: "Collapse children", key: "Mod-ArrowUp" },
  expand: { label: "Expand children", key: "Mod-ArrowDown" },
  toggleCollapse: { label: "Toggle children open or closed", key: "Mod-;" },
  moveUp: { label: "Move block up", key: "Alt-Shift-ArrowUp", mac: "Mod-Shift-ArrowUp" },
  moveDown: { label: "Move block down", key: "Alt-Shift-ArrowDown", mac: "Mod-Shift-ArrowDown" },
  follow: { label: "Follow the link under the caret", key: "Mod-o" },
  followInSidebar: { label: "Open the link under the caret in the sidebar", key: "Mod-Shift-o" },
  zoomIn: { label: "Zoom into the block", key: "Alt-ArrowRight", mac: "Mod-." },
  zoomOut: { label: "Zoom out of the block", key: "Alt-ArrowLeft", mac: "Mod-," },
} as const satisfies Record<string, Binding>

export const bound = ({ key, mac }: Binding) => (mac === undefined ? { key } : { key, mac })
