import type { Table } from "./names.ts"

export interface LatexParts {
  readonly "seqno-latex": readonly []
  readonly "seqno-latex-inline": readonly []
  readonly "seqno-latex-source": readonly []
}

export const latexParts: Table<LatexParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/latex.cljs#L65-L69
  "seqno-latex": () => ({ className: "latex initial" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/latex.cljs#L65-L69
  "seqno-latex-inline": () => ({ className: "latex-inline initial" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/latex.cljs#L70
  "seqno-latex-source": () => ({ className: "opacity-0" }),
}
