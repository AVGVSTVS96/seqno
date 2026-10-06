import { describe, expect, it } from "vitest"
import { corpus } from "../src/corpus.ts"
import { printSimple } from "../src/syntax/print.ts"
import { parseSimple } from "../src/syntax/simple.ts"
import { translateLogseq } from "../src/translate.ts"

const original = (id: string) => corpus.find((e) => e.id === id)!.original

const translated: ReadonlyArray<readonly [string, string, string, number]> = [
  ["docs 1: all tasks", "{:title \"All tasks\" :query [:find (pull ?b [*]) :where [?b :block/marker _]]}", "(task.status)", 0],
  ["docs 2: tag project", '{:query [:find (pull ?b [*]) :where [?p :block/name "project"] [?b :block/refs ?p]]}', "(ref project)", 0],
  ["docs 17: simple query inside advanced", '{:title "DOING tasks with priority A" :query (and (todo DOING) (priority A)) :collapsed? true}', "(and (task doing) (priority a))", 0],
  ["docs 18: children of the query block", "{:inputs [:current-block] :query [:find (pull ?b [*]) :in $ ?current-block :where [?b :block/parent ?current-block]]}", "(child-of (id @block))", 0],
  ["Q02 active", original("Q02"), "(and (task now doing) (between -2w today) (sort-by priority asc))", 0],
  ["Q03 next 7 days", original("Q03"), "(or (and (task.scheduled > today) (task.scheduled < +7d)) (and (task.deadline > today) (task.deadline < +7d)))", 0],
  ["Q06 property", original("Q06"), "(property type programming_lang)", 0],
  ["Q08 current page", original("Q08"), "(and (ref @page) (task todo))", 0],
  ["Q09 page-ref + between", original("Q09"), "(and (between -7d today) [[datalog]])", 0],
  ["Q10 namespace", original("Q10"), "(and (namespace projects) (task todo))", 1],
  ["Q11 get-children rule", original("Q11"), '(and (under "v23-05") (task todo))', 1],
  ["Q12 check-doing rule", original("Q12"), "(and (task todo) (not (under (task doing))))", 0],
  ["Q13 rules as input", original("Q13"), '(and "TODO" (not (task.status)))', 1],
  ["Q14 pages with tag", original("Q14"), "(page-tags programming)", 1],
]

const convertMe: ReadonlyArray<readonly [string, string, RegExp]> = [
  ["Q16 or-join", original("Q16"), /or-join/],
  ["Q17 aggregate", original("Q17"), /aggregates/],
  [
    "docs 16: clojure fn in a rule",
    '{:query [:find (pull ?b [*]) :in $ % :where (starts-with ?b "https://")] :rules [[(starts-with ?b ?substr) [?b :block/content ?content] [(clojure.string/starts-with? ?content ?substr)]]]}',
    /starts-with/,
  ],
  ["unknown attribute", "{:query [:find (pull ?b [*]) :where [?b :block/collapsed? true]]}", /collapsed/],
]

describe("Logseq advanced queries that translate", () => {
  it.each(translated)("%s", (_, src, expected, warnings) => {
    const t = translateLogseq(src)
    expect(t._tag).toBe("Translated")
    if (t._tag !== "Translated") return
    expect(t.query).toEqual(parseSimple(expected))
    expect(parseSimple(printSimple(t.query))).toEqual(t.query)
    expect(t.warnings).toHaveLength(warnings)
  })
})

describe("queries that become 'convert me' blocks", () => {
  it.each(convertMe)("%s", (_, src, reason) => {
    const t = translateLogseq(src)
    expect(t._tag).toBe("ConvertMe")
    if (t._tag === "ConvertMe") expect(t.reason).toMatch(reason)
  })
})
