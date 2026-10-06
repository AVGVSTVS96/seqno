import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { parseDataviewQuery, parseLogseqQuery, printLogseqQuery, type Query } from "../src/index.ts"

const OPEN = "todo, doing, now, later, waiting"

const corpus: ReadonlyArray<
  readonly [id: string, logseq: string, dataview: string, printed: string]
> = [
  [
    "Q01",
    "{{query (task now later)}}",
    "LIST WHERE task.status IN (now, later)",
    "{{query (task now later)}}",
  ],
  [
    "Q02",
    "{{query (and (task now doing) (between -2w today) (sort-by priority asc))}}",
    "LIST WHERE task.status IN (now, doing) AND page.day BETWEEN -2w AND today SORT task.priority ASC",
    "{{query (and (task now doing) (between -2w today)) (sort-by task.priority asc)}}",
  ],
  [
    "Q03",
    "{{query (or (between task.scheduled today +7d) (between task.deadline today +7d)) (view table task.scheduled task.deadline page)}}",
    "TABLE task.scheduled, task.deadline, page WHERE task.scheduled BETWEEN today AND +7d OR task.deadline BETWEEN today AND +7d",
    "{{query (or (between task.scheduled today +7d) (between task.deadline today +7d)) (view table task.scheduled task.deadline page)}}",
  ],
  [
    "Q04",
    "{{query (and (task todo doing now later waiting) (tag database)) (view board task.status)}}",
    `BOARD BY task.status WHERE task.status IN (${OPEN}) AND tag = database`,
    "{{query (and (task todo doing now later waiting) (tag database)) (view board task.status)}}",
  ],
  [
    "Q05",
    "{{query (task todo doing now later waiting) (group-by page)}}",
    `LIST WHERE task.status IN (${OPEN}) GROUP BY page`,
    "{{query (task todo doing now later waiting) (group-by page)}}",
  ],
  [
    "Q06",
    "{{query (property type book)}}",
    "LIST WHERE property.type = book",
    "{{query (property type book)}}",
  ],
  [
    "Q07",
    "{{query (pages (namespace project) (sort-by page.property.rating desc) (view table page.property.type page.property.rating))}}",
    'TABLE PAGES page.property.type, page.property.rating FROM "project" SORT page.property.rating DESC',
    "{{query (pages (namespace project)) (sort-by page.property.rating desc) (view table page.property.type page.property.rating)}}",
  ],
  [
    "Q08",
    "{{query (and (ref @page) (task todo))}}",
    "LIST WHERE ref = @page AND task.status = todo",
    "{{query (and (ref @page) (task todo))}}",
  ],
  [
    "Q09",
    "{{query (and [[architecture]] (between -7d today))}}",
    "LIST FROM [[architecture]] WHERE page.day BETWEEN -7d AND today",
    "{{query (and [[architecture]] (between -7d today))}}",
  ],
  [
    "Q10",
    "{{query (and (namespace project) (task todo))}}",
    'LIST FROM "project" WHERE task.status = todo',
    "{{query (and (namespace project) (task todo))}}",
  ],
  [
    "Q11",
    '{{query (and (task todo) (under "release"))}}',
    'LIST WHERE task.status = todo AND UNDER (text MATCHES "release")',
    '{{query (and (task todo) (under "release"))}}',
  ],
  [
    "Q12",
    "{{query (and (task todo) (not (under (task doing))))}}",
    "LIST WHERE task.status = todo AND NOT UNDER (task.status = doing)",
    "{{query (and (task todo) (not (under (task doing))))}}",
  ],
  [
    "Q13",
    '{{query (and "deploy" (not (task.status)))}}',
    'LIST WHERE text MATCHES "deploy" AND NOT task.status',
    '{{query (and "deploy" (not (task.status)))}}',
  ],
  [
    "Q14",
    '{{query (page-tags "Hidden Finance")}}',
    'LIST PAGES WHERE page.tag = "Hidden Finance"',
    '{{query (pages (page.tag "Hidden Finance"))}}',
  ],
  [
    "Q15",
    "{{query (and (updated >= -1d) (sort-by updated desc))}}",
    "LIST WHERE updated >= -1d SORT updated DESC",
    "{{query (updated >= -1d) (sort-by updated desc)}}",
  ],
]

const printed = (parsed: Result.Result<Query, unknown>) => Result.flatMap(parsed, printLogseqQuery)

describe("both syntaxes read every corpus query into the same AST", () => {
  it.each(corpus)("%s", (_, logseq, dataview, expected) => {
    expect(printed(parseLogseqQuery(logseq))).toEqual(Result.succeed(expected))
    expect(printed(parseDataviewQuery(dataview))).toEqual(Result.succeed(expected))
  })

  it.each(corpus)("%s printed text reads back to itself", (_, __, ___, expected) => {
    expect(printed(parseLogseqQuery(expected))).toEqual(Result.succeed(expected))
  })
})

describe("the AST is the typed shape the compiler expects", () => {
  it("Q02: tasks on recent journals sorted by priority", () => {
    expect(
      parseLogseqQuery(
        "{{query (and (task NOW doing) (between -2w today) (sort-by priority asc))}}",
      ),
    ).toEqual(
      Result.succeed({
        find: "blocks",
        where: {
          _tag: "And",
          all: [
            { _tag: "In", field: "task.status", values: ["now", "doing"] },
            {
              _tag: "Between",
              field: "page.day",
              from: { _tag: "RelDate", amount: -2, unit: "w" },
              to: { _tag: "RelDate", amount: 0, unit: "d" },
            },
          ],
        },
        sort: [{ field: "task.priority", dir: "asc" }],
      }),
    )
  })

  it("Q12: negated recursive ancestor", () => {
    expect(
      parseDataviewQuery("LIST WHERE task.status = todo AND NOT UNDER (task.status = doing)"),
    ).toEqual(
      Result.succeed({
        find: "blocks",
        where: {
          _tag: "And",
          all: [
            { _tag: "Compare", field: "task.status", op: "=", value: "todo" },
            {
              _tag: "Not",
              filter: {
                _tag: "Under",
                ancestor: { _tag: "Compare", field: "task.status", op: "=", value: "doing" },
                self: false,
                direct: false,
              },
            },
          ],
        },
      }),
    )
  })

  it("a [[page]] reference also matches blocks nested under a reference", () => {
    expect(parseLogseqQuery("[[Hidden Finance]]")).toEqual(
      Result.succeed({
        find: "blocks",
        where: {
          _tag: "Under",
          ancestor: { _tag: "Compare", field: "ref", op: "=", value: "Hidden Finance" },
          self: true,
          direct: false,
        },
      }),
    )
  })

  it("journal-style dates in Logseq text become absolute days", () => {
    expect(parseLogseqQuery("(between task.deadline [[Oct 5th, 2026]] 2026-10-12)")).toEqual(
      Result.succeed({
        find: "blocks",
        where: {
          _tag: "Between",
          field: "task.deadline",
          from: { _tag: "AbsDate", ymd: 20261005 },
          to: { _tag: "AbsDate", ymd: 20261012 },
        },
      }),
    )
  })
})

const failure = (r: Result.Result<unknown, { readonly message: string }>) =>
  Result.isFailure(r) ? r.failure.message : "succeeded"

describe("bad input is a QueryError with a plain message", () => {
  it.each([
    [
      "mixed page and block filters",
      parseLogseqQuery("(and (task todo) (page-tags x))"),
      "page filters (pages, page-property, page-tags, has-block) can't be mixed with block filters",
    ],
    ["unknown field", parseLogseqQuery("(task.colour red)"), 'unknown field "task.colour"'],
    ["unclosed list", parseLogseqQuery("(and (task todo)"), "missing )"],
    [
      "unknown view",
      parseLogseqQuery("(task todo) (view kanban)"),
      'unknown view "kanban"; use list, table or board',
    ],
    ["negative limit", parseLogseqQuery("(task todo) (limit -1)"), "(limit) takes a whole number"],
    ["fractional limit", parseDataviewQuery("LIST LIMIT 2.5"), "LIMIT takes a whole number"],
    [
      "IN without a list",
      parseDataviewQuery("LIST WHERE task.status IN todo"),
      "IN takes a list: IN (a, b)",
    ],
    [
      "trailing tokens",
      parseDataviewQuery("LIST WHERE task.status = todo todo"),
      'unexpected "todo"',
    ],
    ["unreadable character", parseDataviewQuery("LIST WHERE ref = !x"), 'can\'t read "!x"'],
  ])("%s", (_, result, message) => expect(failure(result)).toBe(message))
})
