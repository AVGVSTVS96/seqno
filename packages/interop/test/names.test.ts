import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import {
  defaultConfig,
  fileBodyFromTitle,
  formatJournalDay,
  needsTitleProperty,
  parseConfig,
  parseJournalDay,
  titleFromFileBody,
} from "@seqno/interop"

describe("page file names", () => {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["Project X", "Project X"],
    ["a/b/c", "a___b___c"],
    ["What? Why: now", "What%3F Why%3A now"],
    ['<a|b> "c" #d \\ *e', "%3Ca%7Cb%3E %22c%22 %23d %5C %2Ae"],
    ["100%", "100%"],
    ["100%25", "100%2525"],
    ["CON", "CON___"],
    ["ends.", "ends.___"],
    [".hidden", "%2Ehidden"],
    ["a___b", "a%5F%5F%5Fb"],
    ["a_/b", "a%5F___b"],
    ["a/_b", "a___%5Fb"],
    ["con", "con"],
  ]

  it("encodes titles the way Logseq's triple-lowbar format does", () => {
    assert.deepStrictEqual(
      pairs.map(([title]) => fileBodyFromTitle(title, "triple-lowbar")),
      pairs.map(([, body]) => body),
    )
  })

  it("decodes every encoded title back to itself", () => {
    assert.deepStrictEqual(
      pairs.map(([, body]) => titleFromFileBody(body, "triple-lowbar")),
      pairs.map(([title]) => title),
    )
  })

  it("encodes titles the way Logseq's legacy format does, and knows when the title needs title::", () => {
    const legacy = ["a/b", "What? Why: now", "100%", "#tag|x \\ *e", "v1.2 notes", "/edge/"]
    assert.deepStrictEqual(
      legacy.map((title) => [
        fileBodyFromTitle(title, "legacy"),
        needsTitleProperty(title, "legacy"),
      ]),
      [
        ["a%2Fb", false],
        ["What%3F Why%3A now", false],
        ["100%25", false],
        ["%23tag%7Cx %5C %2Ae", false],
        ["v1.2 notes", true],
        ["edge", true],
      ],
    )
    assert.deepStrictEqual(
      pairs.filter(([title]) => needsTitleProperty(title, "triple-lowbar")),
      [],
    )
  })

  it("reads legacy dot namespaces and NFD names", () => {
    assert.strictEqual(titleFromFileBody("work.projects%2Fq4", "legacy"), "work/projects/q4")
    assert.strictEqual(titleFromFileBody("Cafe\u0301", "triple-lowbar"), "Caf\u00E9")
    assert.strictEqual(
      titleFromFileBody("bad %E0%A4%A escape", "triple-lowbar"),
      "bad %E0%A4%A escape",
    )
  })
})

describe("journal days", () => {
  it("formats every token Logseq's title formats use", () => {
    assert.deepStrictEqual(
      ["MMM do, yyyy", "EEEE, dd.MM.yyyy", "E, MM/dd/yyyy", "do MMMM yyyy", "yyyy年MM月dd日"].map(
        (format) => formatJournalDay(20_261_006, format),
      ),
      [
        "Oct 6th, 2026",
        "Tuesday, 06.10.2026",
        "Tue, 10/06/2026",
        "6th October 2026",
        "2026年10月06日",
      ],
    )
    assert.deepStrictEqual(
      [20_260_101, 20_260_102, 20_260_103, 20_260_111, 20_260_122].map((day) =>
        formatJournalDay(day, "do"),
      ),
      ["1st", "2nd", "3rd", "11th", "22nd"],
    )
  })

  it("parses file names and titles back to days, rejecting impossible dates", () => {
    assert.deepStrictEqual(parseJournalDay("2026_10_06", "yyyy_MM_dd"), Option.some(20_261_006))
    assert.deepStrictEqual(
      parseJournalDay("Oct 6th, 2026", "MMM do, yyyy"),
      Option.some(20_261_006),
    )
    assert.deepStrictEqual(
      parseJournalDay("Tuesday, 06.10.2026", "EEEE, dd.MM.yyyy"),
      Option.some(20_261_006),
    )
    assert.deepStrictEqual(parseJournalDay("2026_02_30", "yyyy_MM_dd"), Option.none())
    assert.deepStrictEqual(parseJournalDay("meeting notes", "yyyy_MM_dd"), Option.none())
  })
})

describe("config.edn", () => {
  it("reads top-level keys, skipping comments, tags and nested maps", () => {
    const source = [
      "{:meta/version 1",
      ' ;; :journal/page-title-format "yyyy-MM-dd"',
      ' :journal/page-title-format "EEEE, dd.MM.yyyy" ; trailing comment',
      ' :default-queries {:journals [{:title "x" :journal/file-name-format "wrong"}]}',
      ' :created-at #inst "2024-01-01"',
      ' :journal/file-name-format "yyyy-MM-dd"',
      " :file/name-format :triple-lowbar",
      ' :pages-directory "./notes/"',
      ' :preferred-format "Org"',
      ' :hidden ["/archive" "drafts"]}',
    ].join("\n")

    assert.deepStrictEqual(parseConfig(source), {
      journalTitleFormat: "EEEE, dd.MM.yyyy",
      journalFileFormat: "yyyy-MM-dd",
      fileNameFormat: "triple-lowbar",
      pagesDirectory: "notes",
      journalsDirectory: "journals",
      whiteboardsDirectory: "whiteboards",
      hidden: ["archive", "drafts"],
      preferredFormat: "org",
    })
  })

  it("treats a config without :file/name-format as the legacy format", () => {
    assert.deepStrictEqual(parseConfig("{}"), { ...defaultConfig, fileNameFormat: "legacy" })
  })
})
