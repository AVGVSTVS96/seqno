import { names } from "./names.ts"
import type { Table } from "./names.ts"

export interface PageParts {
  readonly "seqno-page": readonly [boolean]
  readonly "seqno-page-title-wrap": readonly []
  readonly "seqno-page-blocks": readonly []
  readonly "seqno-page-title": readonly []
  readonly "seqno-page-title-link": readonly []
  readonly "seqno-page-title-sizer": readonly []
  readonly "seqno-page-title-text": readonly [string]
  readonly "seqno-page-properties": readonly []
  readonly "seqno-page-properties-control": readonly []
  readonly "seqno-page-properties-bullet": readonly []
  readonly "seqno-properties": readonly []
  readonly "seqno-property-key": readonly []
  readonly "seqno-property-value": readonly []
  readonly "seqno-journals": readonly []
  readonly "seqno-journal": readonly []
  readonly "seqno-fold": readonly []
  readonly "seqno-reference-crumbs": readonly []
  readonly "seqno-references": readonly ["linked" | "unlinked"]
  readonly "seqno-references-head": readonly []
  readonly "seqno-references-body": readonly []
  readonly "seqno-references-group": readonly []
  readonly "seqno-graph-view": readonly []
  readonly "graph-root": readonly []
  readonly "graph-toolbar": readonly []
  readonly "seqno-all-pages": readonly []
  readonly "seqno-view-actions": readonly []
  readonly "seqno-view-filter": readonly []
  readonly "seqno-view-filter-input": readonly []
  readonly "seqno-table": readonly []
  readonly "seqno-page-title-editor": readonly []
  readonly "seqno-page-title-input": readonly []
  readonly "seqno-crumb-label": readonly []
}

export const pageParts: Table<PageParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L455
  "seqno-page": (journal) => ({ className: names(journal && "journal", "page") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L478
  "seqno-page-title-wrap": () => ({ className: "ls-page-title" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L104
  "seqno-page-blocks": () => ({ className: "page-blocks-inner content" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L340
  "seqno-page-title": () => ({ className: "page-title title" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/journal.cljs#L42
  "seqno-page-title-link": () => ({ className: "journal-title" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L358
  "seqno-page-title-sizer": () => ({ className: "page-title-sizer-wrapper" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L368-L370
  "seqno-page-title-text": (name) => ({ className: "title", "data-ref": name }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2867
  "seqno-page-properties": () => ({ className: "pre-block" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1754
  "seqno-page-properties-control": () => ({ className: "block-control-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1789
  "seqno-page-properties-bullet": () => ({ className: "bullet" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2079-L2080
  "seqno-properties": () => ({ className: "block-properties page-properties" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2042
  "seqno-property-key": () => ({ className: "page-property-key" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2044
  "seqno-property-value": () => ({ className: "page-property-value" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/journal.cljs#L77
  "seqno-journals": () => ({ className: "", id: "journals" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/journal.cljs#L81
  "seqno-journal": () => ({ className: "journal-item content" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L781
  "seqno-fold": () => ({ className: "block-control" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2611
  "seqno-reference-crumbs": () => ({ className: "breadcrumb block-parents" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/reference.cljs#L242-L286
  "seqno-references": (kind) => ({ className: `references page-${kind} content` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L773
  "seqno-references-head": () => ({ className: "foldable-title" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/reference.cljs#L112
  "seqno-references-body": () => ({ className: "references-blocks" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3529
  "seqno-references-group": () => ({ className: "references-blocks-item" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L809
  "seqno-graph-view": () => ({ className: "", id: "global-graph" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/graph.cljs#L61
  "graph-root": () => ({ className: "graph" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L603
  "graph-toolbar": () => ({ className: "graph-filters" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L1067
  "seqno-all-pages": () => ({ className: "cp__all_pages" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L1111
  "seqno-view-actions": () => ({ className: "actions" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L1132
  "seqno-view-filter": () => ({ className: "search-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L1146
  "seqno-view-filter-input": () => ({ className: "form-input" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L1208
  "seqno-table": () => ({ className: "cp__all_pages_table" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L291-L292
  "seqno-page-title-editor": () => ({ className: "edit-input-wrapper editing" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L293
  "seqno-page-title-input": () => ({ className: "edit-input" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2600
  "seqno-crumb-label": () => ({ className: "inline-wrap" }),
}
