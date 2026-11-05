const why = {
  flat: "seqno's outline is one flat, virtualized list of rows, so no block holds its children",
  cm5Options:
    "CodeMirror 5's gutter markers and vim cursor, which Logseq shows only when config.edn's :editor/extra-codemirror-options turns them on; seqno edits code with CodeMirror 6",
  hljsLanguages:
    "a highlight.js class only for languages seqno doesn't highlight (Markdown, diff, templates)",
  platform: "set only in Logseq's desktop or mobile app",
  tailwind: "a Tailwind utility Logseq writes into its markup; seqno doesn't use Tailwind",
  shui: "Logseq's Radix UI kit; seqno's menus, selects and popovers are its own",
  wrapper:
    "an outer wrapper Logseq puts around a popup or dialog; seqno's is one element, which carries the inner names",
  tabler: "Logseq's Tabler icon font; seqno draws icons as SVG",
  tldraw: "Logseq's tldraw whiteboard; seqno's whiteboards draw on their own canvas",
  stale: "Logseq 0.10.9's stylesheets select it, but no 0.10.9 screen renders it",
  palette: "part of Logseq's command palette and document mode, which the palette build is adding",
  cards: "flashcard review, which comes with the flashcards build",
  gitDialogs:
    "the dialog headline of Logseq's git, commit and Zotero dialogs, which seqno doesn't have yet",
  defaultQueries:
    "the default queries under today's journal (:default-queries), which seqno doesn't have yet",
  batchDelete: "the batch-delete bar of Logseq's All pages table, which seqno doesn't have yet",
  filters: "Logseq's linked references filter dialog, which seqno doesn't have yet",
  queryBuilder: "Logseq's query builder, which seqno doesn't have yet",
  handbooks: "search in Logseq's handbooks panel, which seqno doesn't have yet",
  tables: "Logseq's Markdown table rendering, which seqno doesn't have yet",
  priority: "the picker Logseq shows on hovering a priority marker, which seqno doesn't have yet",
  embedEdit:
    "the edit button beside an embedded block and YouTube timestamps, which seqno doesn't have yet",
} as const

const each = (reason: string, names: readonly string[]) =>
  names.map((name) => [name, reason] as const)

export const gaps: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ...each(why.flat, [".block-children", ".block-children-container"]),
    ...each(why.cm5Options, [
      ".CodeMirror-guttermarker",
      ".CodeMirror-guttermarker-subtle",
      ".cm-animate-fat-cursor",
      ".cm-fat-cursor",
    ]),
    ...each(why.hljsLanguages, [
      ".hljs-addition",
      ".hljs-bullet",
      ".hljs-code",
      ".hljs-deletion",
      ".hljs-emphasis",
      ".hljs-link",
      ".hljs-quote",
      ".hljs-section",
      ".hljs-strong",
      ".hljs-template-tag",
      ".hljs-template-variable",
    ]),
    ...each(why.platform, [
      "#mobile-editor-toolbar",
      ".close",
      ".is-electron",
      ".is-mobile",
      ".is-native-iphone",
      ".navigation",
      ".update-state",
    ]),
    ...each(why.tailwind, [
      ".bg-base-3",
      ".border-gray-06",
      ".border-gray-07",
      ".flex-1",
      ".opacity-80",
    ]),
    ...each(why.shui, [
      ".ui__context-menu-content",
      ".ui__dropdown-menu-content",
      ".ui__select-content",
      "[data-radix-popper-content-wrapper]",
    ]),
    ...each(why.wrapper, [".tippy-popper", ".ui__modal"]),
    ...each(why.tabler, [".tie", ".ui__icon"]),
    ...each(why.tldraw, [
      ".dashboard-card",
      ".dashboard-card-title",
      ".tl-action-bar",
      ".tl-button",
      ".tl-container",
      ".whiteboard-page",
    ]),
    ...each(why.stale, ["#main-content", ".add-button", ".pull", ".table-query-properties"]),
    ...each(why.palette, [
      ".cp__palette-main",
      ".cp__select",
      ".cp__select-input",
      ".doc-mode",
      ".item-results-wrap",
    ]),
    ...each(why.cards, [".cards-review"]),
    ...each(why.gitDialogs, ["#modal-headline"]),
    ...each(why.defaultQueries, ["#today-queries"]),
    ...each(why.batchDelete, [".actions-wrap", ".has-selected"]),
    ...each(why.filters, [".ls-filters"]),
    ...each(why.queryBuilder, [".query-builder-picker"]),
    ...each(why.handbooks, [".search-results-wrap"]),
    ...each(why.tables, [".table-wrapper"]),
    ...each(why.priority, [".tooltip-priority"]),
    ...each(why.embedEdit, [".svg-small"]),
  ].toSorted(([a], [b]) => (a < b ? -1 : 1)),
)
