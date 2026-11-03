import type { Table } from "./names.ts"

export interface SlideParts {
  readonly "seqno-slides": readonly []
  readonly "seqno-slides-deck": readonly []
  readonly "seqno-slides-list": readonly []
}

export const slideParts: Table<SlideParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L177
  "seqno-slides": () => ({ className: "slide" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/slide.cljs#L68
  "seqno-slides-deck": () => ({ className: "reveal" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/slide.cljs#L71
  "seqno-slides-list": () => ({ className: "slides" }),
}
