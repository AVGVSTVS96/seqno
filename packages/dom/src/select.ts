import { names, type Table } from "./names.ts"

export interface SelectParts {
  readonly "seqno-select": readonly []
  readonly "seqno-select-input": readonly []
  readonly "seqno-select-results": readonly []
}

export const selectParts: Table<SelectParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/select.cljs#L59-L60
  "seqno-select": () => ({ className: names("cp__select", "cp__select-main") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/select.cljs#L62
  "seqno-select-input": () => ({ className: "cp__select-input" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/select.cljs#L81
  "seqno-select-results": () => ({ className: "cp__select-results" }),
}
