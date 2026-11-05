import { definePlugin } from "@oxlint/plugins"
import { logseqNames } from "./logseq-names.ts"

export default definePlugin({
  meta: { name: "seqno" },
  rules: { "logseq-names": logseqNames },
})
