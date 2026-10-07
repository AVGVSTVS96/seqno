import { assert, describe, it } from "@effect/vitest"
import { byMatch, fuzzyMatch } from "../src/fuzzy.ts"
import {
  caretAt,
  insertLink,
  quoteLine,
  setHeading,
  setMarker,
  setOrderedList,
  setPlanning,
  setPriority,
} from "../src/format.ts"

const at = (text: string) => caretAt(text, text.length)

describe("block text transforms", () => {
  it("sets, replaces and removes the task marker after a heading", () => {
    assert.deepStrictEqual(
      [
        setMarker(at("plant beans"), "TODO").text,
        setMarker(at("TODO plant beans"), "DOING").text,
        setMarker(at("## LATER plant beans"), "NOW").text,
        setMarker(at("DONE plant beans"), null).text,
      ],
      ["TODO plant beans", "DOING plant beans", "## NOW plant beans", "plant beans"],
    )
  })

  it("puts the priority after the marker and replaces an old one", () => {
    assert.deepStrictEqual(
      [
        setPriority(at("TODO water"), "A").text,
        setPriority(at("TODO [#C] water"), "B").text,
        setPriority(at("[#A] water"), null).text,
      ],
      ["TODO [#A] water", "TODO [#B] water", "water"],
    )
  })

  it("sets and clears heading levels", () => {
    assert.deepStrictEqual(
      [
        setHeading(at("plan"), 2).text,
        setHeading(at("### plan"), 1).text,
        setHeading(at("# plan"), null).text,
      ],
      ["## plan", "# plan", "plan"],
    )
  })

  it("writes SCHEDULED on the line after the title, replacing an older date", () => {
    assert.deepStrictEqual(
      [
        setPlanning(at("TODO sow\nnotes"), "SCHEDULED", "2026-10-06 Tue").text,
        setPlanning(at("TODO sow\nDEADLINE: <2026-10-01 Thu>"), "DEADLINE", "2026-10-06 Tue").text,
      ],
      ["TODO sow\nSCHEDULED: <2026-10-06 Tue>\nnotes", "TODO sow\nDEADLINE: <2026-10-06 Tue>"],
    )
    assert.strictEqual(
      setPlanning(at("water the beds  "), "SCHEDULED", "2026-10-06 Tue").text,
      "water the beds\nSCHEDULED: <2026-10-06 Tue>",
    )
  })

  it("numbers the block through Logseq's list property", () => {
    assert.strictEqual(setOrderedList(at("step")).text, "step\nlogseq.order-list-type:: number")
  })

  it("quotes the caret's line once", () => {
    assert.deepStrictEqual(
      [quoteLine(at("a\nb")).text, quoteLine(at("> b")).text],
      ["a\n> b", "> b"],
    )
  })

  it("keeps a bare URL as the link target", () => {
    assert.deepStrictEqual(insertLink({ text: "https://logseq.com", from: 0, to: 18 }), {
      text: "[](https://logseq.com)",
      from: 1,
      to: 1,
    })
  })
})

const rank = (labels: ReadonlyArray<string>, query: string) =>
  labels
    .flatMap((label) => {
      const match = fuzzyMatch(label, query)
      return match === null ? [] : [{ label, match }]
    })
    .toSorted(byMatch)
    .map(({ label }) => label)

describe("fuzzy ranking", () => {
  it("orders Logseq 2.x's own slash items the way Logseq does", () => {
    const logseq = [
      "Node reference",
      "Math block",
      "Heading 1",
      "Heading 2",
      "Todo",
      "Priority Low",
      "Priority High",
      "Scheduled",
      "Tomorrow",
      "Today",
      "Number children",
      "Calculator",
      "Embed HTML",
      "Query function",
    ]
    assert.deepStrictEqual(rank(logseq, "to"), [
      "Todo",
      "Today",
      "Tomorrow",
      "Calculator",
      "Math block",
      "Priority Low",
      "Query function",
    ])
    assert.deepStrictEqual(rank(logseq, "h"), [
      "Heading 1",
      "Heading 2",
      "Scheduled",
      "Math block",
      "Embed HTML",
      "Number children",
      "Priority High",
    ])
  })
})
