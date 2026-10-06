import { EditorView } from "@codemirror/view"

const heading = (size: string, leading: string, rule: string | null) => ({
  ...(rule === null
    ? {}
    : {
        marginBlock: rule,
        paddingBottom: rule,
        borderBottom: "1px solid var(--border-heading)",
      }),
  "& .cm-content": {
    fontSize: size,
    lineHeight: leading,
    fontWeight: "var(--weight-semibold)",
  },
})

const enter = (lift: string) => ({
  from: { opacity: "0", transform: `translateY(${lift}) scale(0.95)` },
})

const row = {
  display: "flex",
  boxSizing: "border-box",
  minHeight: "32px",
  padding: "6px 8px",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-sm)",
  lineHeight: "var(--leading-sm)",
  color: "var(--fg-popup)",
  cursor: "pointer",
  transition: "opacity var(--duration-base) var(--ease-standard)",
}

export const editorTheme = EditorView.theme({
  "&": {
    color: "inherit",
    backgroundColor: "transparent",
    font: "inherit",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    overflow: "visible",
  },
  ".cm-content": {
    padding: "0",
    minHeight: "var(--leading-base)",
    caretColor: "var(--fg)",
  },
  ".cm-line": { padding: "0" },
  "&.sq-h1": heading("var(--text-h1)", "var(--leading-h1)", "4px"),
  "&.sq-h2": heading("var(--text-h2)", "var(--leading-h2)", "3px"),
  "&.sq-h3": heading("var(--text-h3)", "var(--leading-h3)", null),
  "&.sq-h4, &.sq-h5, &.sq-h6": heading("var(--text-base)", "var(--leading-base)", null),

  ".cm-tooltip.sq-popup-host": {
    border: "none",
    backgroundColor: "transparent",
    display: "flex",
    flexDirection: "column",
  },
  "@keyframes sq-popup-below": enter("-8px"),
  "@keyframes sq-popup-above": enter("8px"),
  ".sq-popup": {
    boxSizing: "border-box",
    width: "512px",
    maxWidth: "100vw",
    maxHeight: "100%",
    overflowY: "auto",
    padding: "6px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--bg-popover)",
    boxShadow: "var(--shadow-popover)",
    color: "var(--fg-strong)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-base)",
    lineHeight: "var(--leading-base)",
    transformOrigin: "top left",
    animation: "sq-popup-below var(--duration-base) ease",
  },
  ".cm-tooltip-above .sq-popup": {
    transformOrigin: "bottom left",
    animationName: "sq-popup-above",
  },
  ".sq-popup::-webkit-scrollbar": { display: "none" },
  ".sq-popup.sq-popup-slash": { width: "288px", maxHeight: "min(480px, 100%)" },
  ".sq-popup-group": {
    boxSizing: "border-box",
    height: "32px",
    padding: "8px",
    fontSize: "var(--text-xs)",
    lineHeight: "var(--leading-xs)",
    fontWeight: "var(--weight-medium)",
    color: "var(--fg-popup-group)",
  },
  ".sq-popup-row": row,
  ".sq-popup-row:hover": { color: "var(--fg-strong)" },
  ".sq-popup-row[aria-selected=true]": { backgroundColor: "var(--bg-popup-active)" },
  ".sq-popup-command": { display: "flex", alignItems: "center", gap: "4px", minWidth: "0" },
  ".sq-popup-command-icon": {
    display: "flex",
    flex: "none",
    marginRight: "1px",
    opacity: "var(--opacity-popup-icon)",
  },
  ".sq-popup-row[aria-selected=true] .sq-popup-command-icon": { opacity: "1" },
  ".sq-popup-entry": { display: "flex", alignItems: "flex-start", minWidth: "0" },
  ".sq-popup-icon": {
    display: "flex",
    flex: "none",
    alignItems: "center",
    height: "var(--leading-sm)",
    marginRight: "4px",
    opacity: "0.5",
  },
  ".sq-popup-block": { display: "flex", flexDirection: "column", minWidth: "0", flex: "1" },
  ".sq-popup-crumb": {
    margin: "0 0 4px 3px",
    fontSize: "var(--text-xs)",
    lineHeight: "var(--leading-xs)",
    opacity: "0.7",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".sq-popup-text": { overflowWrap: "anywhere" },
  ".sq-popup mark": {
    padding: "0",
    borderRadius: "0",
    backgroundColor: "var(--bg-mark)",
    color: "var(--fg-mark)",
  },
})
