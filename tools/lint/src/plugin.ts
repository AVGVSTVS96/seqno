import { definePlugin } from "@oxlint/plugins"
import { importBoundaries } from "./boundaries.ts"
import { noAny, noAsCast, noComments, noUseEffect } from "./code-rules.ts"
import { logseqNames } from "./logseq-names.ts"

export default definePlugin({
  meta: { name: "seqno" },
  rules: {
    "no-comments": noComments,
    "no-use-effect": noUseEffect,
    "no-as-cast": noAsCast,
    "no-any": noAny,
    "import-boundaries": importBoundaries,
    "logseq-names": logseqNames,
  },
})
