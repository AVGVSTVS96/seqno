import { corpus } from "../src/corpus.ts"
import { printSimple } from "../src/syntax/print.ts"
import { translateLogseq } from "../src/translate.ts"

const out = corpus
  .filter((e) => e.origin !== "dataview")
  .map((e) => {
    const t = translateLogseq(e.original)
    return t._tag === "Translated"
      ? { id: e.id, title: e.title, result: "translated", query: printSimple(t.query), warnings: t.warnings }
      : { id: e.id, title: e.title, result: "convert-me", reason: t.reason }
  })
console.log(JSON.stringify(out, null, 2))
