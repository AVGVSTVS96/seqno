import type { Block, BlockId } from "@seqno/domain"
import { names } from "./names.ts"
import type { Table } from "./names.ts"
import { refsSelf } from "./refs.ts"

export interface BlockRow {
  readonly block: Block
  readonly level: number
  readonly hasChildren: boolean
  readonly childRefs: string
  readonly folded: boolean
  readonly selected: boolean
  readonly dragged: boolean
}

export interface Bullet {
  readonly blockId: BlockId
  readonly folded: boolean
  readonly numbered: boolean
  readonly hidden?: boolean
}

type Kind = "block" | "page"

export interface BlockParts {
  readonly "seqno-row": readonly [BlockRow]
  readonly "seqno-row-main": readonly []
  readonly "seqno-guide": readonly []
  readonly "seqno-control": readonly [{ readonly folded: boolean; readonly numbered: boolean }]
  readonly "seqno-toggle": readonly [BlockId]
  readonly "seqno-bullet-wrap": readonly []
  readonly "seqno-bullet": readonly [Bullet]
  readonly "seqno-dot": readonly [{ readonly blockId: BlockId; readonly selected: boolean }]
  readonly "seqno-content": readonly []
  readonly "seqno-refs-count": readonly []
  readonly "seqno-planning": readonly []
  readonly "seqno-add-block": readonly []
  readonly "seqno-add-block-link": readonly []
  readonly "seqno-block": readonly [BlockId | null]
  readonly "seqno-title-row": readonly []
  readonly "seqno-title": readonly [string | null]
  readonly "seqno-heading": readonly [string | null]
  readonly "seqno-checkbox": readonly [boolean]
  readonly "seqno-marker": readonly [{ readonly marker: string; readonly switchable: boolean }]
  readonly "seqno-attrs": readonly []
  readonly "seqno-attr-key": readonly []
  readonly "seqno-attr-value": readonly []
  readonly "seqno-body": readonly []
  readonly "seqno-blockref": readonly []
  readonly "seqno-pageref": readonly [string]
  readonly "seqno-pageref-link": readonly [string]
  readonly "seqno-bracket": readonly []
  readonly "seqno-admonition": readonly [string]
  readonly "seqno-admonition-icon": readonly []
  readonly "seqno-admonition-svg": readonly [string]
  readonly "seqno-admonition-body": readonly []
  readonly "seqno-tag": readonly [string]
  readonly "seqno-link": readonly []
  readonly "seqno-priority": readonly []
  readonly "seqno-crumbs": readonly []
  readonly "seqno-embed": readonly [Kind]
  readonly "seqno-embed-title": readonly []
  readonly "seqno-outliner": readonly [boolean, boolean]
  readonly "seqno-outline": readonly [boolean]
  readonly "seqno-preview": readonly []
  readonly "seqno-preview-content": readonly []
  readonly "seqno-preview-page": readonly [Kind]
  readonly "seqno-query": readonly []
  readonly "seqno-query-head": readonly []
  readonly "seqno-query-title": readonly []
  readonly "seqno-query-count": readonly []
  readonly "seqno-query-builder": readonly []
  readonly "seqno-query-add": readonly []
  readonly "seqno-query-clause": readonly []
  readonly "seqno-query-results": readonly []
  readonly "seqno-query-table": readonly []
}

export const blockParts: Table<BlockParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2846-L2873
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/handler/editor.cljs#L226-L230
  "seqno-row": ({ block: row, level, hasChildren, childRefs, folded, selected, dragged }) => ({
    className: names("ls-block", row.id, selected && "selected", dragged && "block-highlight"),
    id: `ls-block-${row.id}`,
    blockid: row.id,
    "data-refs": childRefs,
    level,
    haschild: hasChildren ? "true" : "false",
    "data-refs-self": refsSelf(row.text),
    "data-collapsed": folded || undefined,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2899
  "seqno-row-main": () => ({ className: "block-main-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1716
  "seqno-guide": () => ({ className: "block-children-left-border" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1754-L1756
  "seqno-control": ({ folded, numbered }) => ({
    className: names("block-control-wrap", numbered && "is-order-list", folded && "bullet-closed"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1758-L1759
  "seqno-toggle": (blockId) => ({ className: "block-control", id: `control-${blockId}` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1776
  "seqno-bullet-wrap": () => ({ className: "bullet-link-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1777-L1787
  "seqno-bullet": ({ blockId, folded, numbered, hidden = false }) => ({
    className: names(
      "bullet-container",
      folded && "bullet-closed",
      hidden && "hide-inner-bullet",
      numbered && "as-order-list typed-list",
    ),
    id: `dot-${blockId}`,
    blockid: blockId,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1789-L1792
  "seqno-dot": ({ blockId, selected }) => ({
    className: names("bullet", selected && "selected"),
    blockid: blockId,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2448
  "seqno-content": () => ({ className: "block-content-wrapper" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2383
  "seqno-refs-count": () => ({ className: "open-block-ref-link fade-link" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2111
  "seqno-planning": () => ({ className: "timestamp" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L153
  "seqno-add-block": () => ({ className: "add-button-link-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/page.cljs#L164
  "seqno-add-block-link": () => ({ className: "add-button-link" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2309-L2320
  "seqno-block": (host) => {
    const content = { className: "block-content", "data-type": "default" }

    return host === null ? content : { ...content, id: `block-content-${host}`, blockid: host }
  },
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2337
  "seqno-title-row": () => ({ className: "block-content-inner" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1955-L1966
  "seqno-title": (marker) => ({ className: names("inline", marker?.toLowerCase()) }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1955-L1966
  "seqno-heading": (marker) => ({ className: names(marker?.toLowerCase()) }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L349
  "seqno-checkbox": (checked) => ({ className: names("form-checkbox", checked && "checked") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1861-L1885
  "seqno-marker": ({ marker, switchable }) => ({
    className: switchable
      ? names("marker-switch block-marker", marker)
      : names("task-status block-marker", marker.toLowerCase()),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2079
  "seqno-attrs": () => ({ className: "block-properties" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2042
  "seqno-attr-key": () => ({ className: "page-property-key" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2044
  "seqno-attr-value": () => ({ className: "page-property-value" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2284
  "seqno-body": () => ({ className: "block-body" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L877
  "seqno-blockref": () => ({ className: "block-ref" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L766
  "seqno-pageref": (name) => ({ className: "page-reference", "data-ref": name }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L546-L548
  "seqno-pageref-link": (name) => ({ className: "page-ref", "data-ref": name.toLowerCase() }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L768-L780
  "seqno-bracket": () => ({ className: "bracket" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L836
  "seqno-admonition": (kind) => ({ className: `admonitionblock ${kind}` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L837
  "seqno-admonition-icon": () => ({ className: "admonition-icon" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/svg.cljs#L63-L124
  "seqno-admonition-svg": (kind) => ({ className: kind }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L839
  "seqno-admonition-body": () => ({ className: "" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L546-L548
  "seqno-tag": (name) => ({ className: "tag", "data-ref": name.toLowerCase() }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1218
  "seqno-link": () => ({ className: "external-link" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1899
  "seqno-priority": () => ({ className: "priority" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2611
  "seqno-crumbs": () => ({ className: "breadcrumb block-parents" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L803-L821
  "seqno-embed": (kind) => ({
    className: kind === "block" ? "color-level embed-block" : "color-level embed embed-page",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L825
  "seqno-embed-title": () => ({ className: "embed-header" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3489-L3491
  "seqno-outliner": (embedded, documentMode) => ({
    className: names(!embedded && "content", documentMode && "doc-mode"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3452-L3453
  "seqno-outline": (documentMode) => ({
    className: names("blocks-container", documentMode && "document-mode"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L947-L968
  "seqno-preview": () => ({ className: "tippy-tooltip customized-theme" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L947-L968
  "seqno-preview-content": () => ({ className: "tippy-tooltip-content" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L633
  "seqno-preview-page": (kind) => ({ className: `tippy-wrapper as-${kind}` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1251
  "seqno-query": () => ({ className: "dsl-query custom-query" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query.cljs#L191
  "seqno-query-head": () => ({ className: "th" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query.cljs#L124
  "seqno-query-title": () => ({ className: "custom-query-title" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query.cljs#L132
  "seqno-query-count": () => ({ className: "results-count" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query/builder.cljs#L472
  "seqno-query-builder": () => ({ className: "cp__query-builder" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query/builder.cljs#L254
  "seqno-query-add": () => ({ className: "add-filter" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query/builder.cljs#L326
  "seqno-query-clause": () => ({ className: "query-clause" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query.cljs#L68
  "seqno-query-results": () => ({ className: "custom-query-results" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/query_table.cljs#L206
  "seqno-query-table": () => ({ className: "query-table" }),
}
