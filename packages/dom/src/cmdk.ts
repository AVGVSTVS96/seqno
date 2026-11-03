import { names, type Table } from "./names.ts"

export interface CmdkParts {
  readonly "seqno-palette": readonly []
  readonly "seqno-palette-search": readonly []
  readonly "seqno-palette-list": readonly []
  readonly "seqno-palette-more": readonly []
  readonly "seqno-palette-mark": readonly []
  readonly "seqno-palette-footer": readonly []
  readonly "seqno-palette-action": readonly []
}

export const cmdkParts: Table<CmdkParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L602
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/cmdk.cljs#L959
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/cmdk.cljs#L924
  "seqno-palette": () => ({ className: names("ui__modal-panel", "cp__cmdk__modal", "cp__cmdk") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/cmdk.cljs#L742
  "seqno-palette-search": () => ({ className: "", id: "search" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/cmdk.cljs#L605
  "seqno-palette-list": () => ({ className: "search-results" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/cmdk.cljs#L595
  "seqno-palette-more": () => ({ className: names("text-link", "select-node") }),
  // https://github.com/logseq/logseq/blob/0.10.9/deps/shui/src/logseq/shui/list_item/v1.cljs#L39
  "seqno-palette-mark": () => ({ className: "ui__list-item-highlighted-span" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/cmdk.cljs#L827
  "seqno-palette-footer": () => ({ className: "hints" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/cmdk.cljs#L801
  "seqno-palette-action": () => ({ className: "hint-button" }),
}
