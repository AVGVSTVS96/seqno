import type { Table } from "./names.ts"

export interface FileParts {
  readonly "seqno-file": readonly [string]
  readonly "seqno-file-title": readonly []
}

export const fileParts: Table<FileParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/file.cljs#L111-L112
  "seqno-file": (id) => ({ className: "file", id: `file-edit-wrapper-${id}` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/file.cljs#L113-L114
  "seqno-file-title": () => ({ className: "title" }),
}
