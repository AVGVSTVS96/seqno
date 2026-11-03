import type { Table } from "./names.ts"

export interface ContentParts {
  readonly "seqno-page-menu": readonly []
}

export const contentParts: Table<ContentParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L771
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/content.cljs#L332
  "seqno-page-menu": () => ({ className: "menu-links-wrapper", id: "custom-context-menu" }),
}
