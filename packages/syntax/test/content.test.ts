import { describe, expect, it } from "vitest"
import {
  applyEdit,
  blockContent,
  clockTotal,
  plainText,
  propertyValue,
  setMarker,
  type Body,
  type BlockContent,
} from "../src/index.ts"

const summary = (content: BlockContent) => ({
  marker: content.marker,
  heading: content.heading,
  title: content.title === null ? null : plainText(content.title),
  properties: content.properties.map((property) => `${property.key}: ${plainText(property.value)}`),
  planning: content.planning.map((entry) => `${entry.kind} <${entry.date}>`),
  logbook: content.logbook === null ? null : clockTotal(content.logbook.seconds),
  body: content.body.map((body: Body) => {
    switch (body._tag) {
      case "Paragraph":
        return `p: ${plainText(body.inline)}`
      case "Heading":
        return `h${body.level}: ${plainText(body.inline)}`
      case "Code":
        return `code ${body.language}: ${body.code}`
      case "Quote":
        return `quote: ${body.lines.map(plainText).join(" / ")}`
    }
  }),
  numbered: content.numbered,
})

describe("blockContent", () => {
  it("splits a task into marker, title, planning and logbook", () => {
    expect(
      summary(
        blockContent(
          [
            "TODO [#A] Check the frost cloth",
            "SCHEDULED: <2026-10-08 Thu .+1w>",
            ":LOGBOOK:",
            "CLOCK: [2026-10-04 Sun 09:12:30]--[2026-10-04 Sun 10:47:05] =>  01:34:35",
            "CLOCK: [2026-10-05 Mon 09:00:00]--[2026-10-05 Mon 09:10:00] =>  00:10:00",
            ":END:",
            "a second line",
          ].join("\n"),
        ),
      ),
    ).toStrictEqual({
      marker: "TODO",
      heading: null,
      title: "[#A]Check the frost cloth",
      properties: [],
      planning: ["SCHEDULED <2026-10-08 Thu .+1w>"],
      logbook: "1h44m",
      body: ["p: a second line"],
      numbered: false,
    })
  })

  it("shows properties but hides id, collapsed and logseq.* keys", () => {
    expect(
      summary(
        blockContent(
          [
            "Tomato bed",
            "id:: 0192a5c4-7e10-7a3b-9c4d-5e6f70819203",
            "variety:: San Marzano",
            "location:: [[projects/Greenhouse]]",
            "collapsed:: true",
            "logseq.order-list-type:: number",
          ].join("\n"),
        ),
      ),
    ).toStrictEqual({
      marker: null,
      heading: null,
      title: "Tomato bed",
      properties: ["variety: San Marzano", "location: [[projects/Greenhouse]]"],
      planning: [],
      logbook: null,
      body: [],
      numbered: true,
    })
  })

  it("turns tags and alias values into bare page refs", () => {
    const content = blockContent("alias:: Kitchen Sink\ntags:: design, [[visual check]]")
    expect(content.title).toBe(null)
    expect(
      content.properties.map((property) =>
        property.value.map((node) =>
          node._tag === "PageRef" ? `${node.name}|${node.brackets}` : node._tag,
        ),
      ),
    ).toStrictEqual([["Kitchen Sink|false"], ["design|false", "Text", "visual check|true"]])
  })

  it("reads headings, code fences and quotes", () => {
    expect(summary(blockContent("## Text styles")).heading).toBe(2)
    expect(summary(blockContent("## Text styles")).title).toBe("Text styles")
    expect(summary(blockContent("```ts\nconst a = 1\nconst b = 2\n```")).body).toStrictEqual([
      "code ts: const a = 1\nconst b = 2",
    ])
    expect(summary(blockContent("> Plant the tree\n> and water it")).body).toStrictEqual([
      "quote: Plant the tree / and water it",
    ])
    expect(summary(blockContent("Intro\n```python\ndef f(): pass\n```")).body).toStrictEqual([
      "code python: def f(): pass",
    ])
  })

  it("keeps DONE and CANCELED as markers without the word in the title", () => {
    expect(summary(blockContent("DONE Pour the gravel footings")).title).toBe(
      "Pour the gravel footings",
    )
    expect(summary(blockContent("CANCELLED A second cold frame")).marker).toBe("CANCELLED")
  })

  it("points title spans at the block text", () => {
    const text = "TODO **Order** panels"
    const [first] = blockContent(text).title ?? []
    expect(first === undefined ? "" : text.slice(first.span.from, first.span.to)).toBe("**Order**")
  })
})

const shape = (key: string, value: string) =>
  propertyValue(key, value).map((node) =>
    node._tag === "PageRef" ? `${node._tag}:${node.name}:${node.brackets}` : node._tag,
  )

describe("propertyValue", () => {
  it("reads tags and alias as bare page refs and other values as inline text", () => {
    expect(shape("tags", "design, [[visual check]]")).toStrictEqual([
      "PageRef:design:false",
      "Text",
      "PageRef:visual check:true",
    ])
    expect(shape("location", "[[projects/Greenhouse]]")).toStrictEqual([
      "PageRef:projects/Greenhouse:true",
    ])
    expect(shape("variety", "San Marzano")).toStrictEqual(["Text"])
  })
})

describe("clockTotal", () => {
  it("formats seconds like Logseq", () => {
    expect([35, 300, 5675, 7210, 90_061].map(clockTotal)).toStrictEqual([
      "35s",
      "5m",
      "1h34m",
      "2h",
      "1d1h1m",
    ])
  })
})

const apply = (text: string, marker: Parameters<typeof setMarker>[1]) => {
  const edit = setMarker(text, marker)
  return edit === null ? text : applyEdit(text, edit)
}

describe("setMarker", () => {
  it("adds, replaces and removes the task marker", () => {
    expect(apply("Paint the door", "TODO")).toBe("TODO Paint the door")
    expect(apply("TODO Paint the door\nbody", "DONE")).toBe("DONE Paint the door\nbody")
    expect(apply("DONE Paint the door", null)).toBe("Paint the door")
    expect(apply("", "TODO")).toBe("TODO")
    expect(setMarker("TODO x", "TODO")).toBe(null)
    expect(setMarker("x", null)).toBe(null)
  })
})
