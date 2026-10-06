import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { analyzeBlock, applyEdit, setProperty } from "../src/index.ts"

const uuid = "650e8f2a-1b2c-4d5e-8f90-123456789abc"

describe("analyzeBlock", () => {
  it("reads task, priority, planning, properties and logbook", () => {
    const text = [
      "TODO [#A] ship it",
      "SCHEDULED: <2024-01-15 Mon 10:30 .+1w> DEADLINE: <2024-02-01 Thu ++2d>",
      `id:: ${uuid.toUpperCase()}`,
      ":LOGBOOK:",
      "CLOCK: [2024-01-10 Wed 09:00:00]--[2024-01-10 Wed 09:30:00] =>  00:30:00",
      ":END:",
      "collapsed:: true",
      "body text",
      "late:: not a property",
    ].join("\n")
    const syntax = analyzeBlock(text)
    expect(syntax.marker).toBe("TODO")
    expect(syntax.priority).toBe("A")
    expect(syntax.heading).toBe(null)
    expect(syntax.id).toBe(uuid)
    expect(syntax.collapsed).toBe(true)
    expect(syntax.props).toStrictEqual({ id: uuid.toUpperCase(), collapsed: "true" })
    expect(syntax.scheduled).toStrictEqual({ day: 20240115, time: "10:30", repeater: { kind: ".+", amount: 1, unit: "w" } })
    expect(syntax.deadline).toStrictEqual({ day: 20240201, time: null, repeater: { kind: "++", amount: 2, unit: "d" } })
    expect(syntax.regions.map((region) => [region.kind, region.name, text.slice(region.span.from, region.span.to)])).toStrictEqual([
      ["Drawer", "LOGBOOK", ":LOGBOOK:\nCLOCK: [2024-01-10 Wed 09:00:00]--[2024-01-10 Wed 09:30:00] =>  00:30:00\n:END:"],
    ])
  })

  it("finds page refs, nested refs, tags, block refs and embeds", () => {
    const text = `see [[a [[b]] c]], #tag, #[[multi word]] and ((${uuid}))\n{{embed [[page]]}} done.`
    const syntax = analyzeBlock(text)
    expect(syntax.refs.map((ref) => (ref._tag === "BlockRef" ? `${ref._tag}:${ref.uuid}` : `${ref._tag}:${ref.name}`))).toStrictEqual([
      "PageRef:a [[b]] c",
      "PageRef:b",
      "Tag:tag",
      "Tag:multi word",
      `BlockRef:${uuid}`,
      "PageRef:page",
    ])
    expect(syntax.macros.map((macro) => [macro.name, macro.args, text.slice(macro.span.from, macro.span.to)])).toStrictEqual([
      ["embed", "[[page]]", "{{embed [[page]]}}"],
    ])
    expect(syntax.refs.map((ref) => text.slice(ref.span.from, ref.span.to))).toStrictEqual([
      "[[a [[b]] c]]",
      "[[b]]",
      "#tag",
      "#[[multi word]]",
      `((${uuid}))`,
      "[[page]]",
    ])
  })

  it("ignores refs inside code, queries and headings", () => {
    const text = [
      "## heading `[[code]]` #+not",
      "```clojure",
      "[[in fence]] #fence",
      "```",
      "#+BEGIN_QUERY",
      "{:query [:find ?b :where [?b :block/refs [[q]]]]}",
      "#+END_QUERY",
      "{{query (and [[x]] (task TODO))}}",
      "#+BEGIN_QUOTE",
      "quoted [[kept]]",
      "#+END_QUOTE",
    ].join("\n")
    const syntax = analyzeBlock(text)
    expect(syntax.heading).toBe(2)
    expect(syntax.refs.map((ref) => (ref._tag === "BlockRef" ? ref.uuid : ref.name))).toStrictEqual(["kept"])
    expect(syntax.regions.map((region) => `${region.kind}:${region.name}`)).toStrictEqual([
      "Fence:clojure",
      "Directive:QUERY",
      "Directive:QUOTE",
    ])
    expect(syntax.macros.map((macro) => `${macro.name}|${macro.args}`)).toStrictEqual(["query|(and [[x]] (task TODO))"])
  })

  it("reads page properties from a preamble, with tags and alias lists as refs", () => {
    const syntax = analyzeBlock("title:: My Page\ntags:: one, [[Two Words]], #three\nalias:: mp\n")
    expect(syntax.props).toStrictEqual({ title: "My Page", tags: "one, [[Two Words]], #three", alias: "mp" })
    expect(syntax.refs.map((ref) => (ref._tag === "BlockRef" ? ref.uuid : ref.name))).toStrictEqual(["one", "Two Words", "three", "mp"])
    expect(syntax.marker).toBe(null)
  })

  it("does not treat later key:: lines in the body as properties", () => {
    expect(analyzeBlock("title line\nplain text\nkey:: value").props).toStrictEqual({})
  })
})

describe("setProperty", () => {
  it("adds, replaces and removes property lines with minimal edits", () => {
    const text = "DONE task\nSCHEDULED: <2024-01-15 Mon>\nbody"
    const added = applyEdit(text, setProperty(text, "collapsed", "true") ?? { from: 0, to: 0, insert: "" })
    expect(added).toBe("DONE task\ncollapsed:: true\nSCHEDULED: <2024-01-15 Mon>\nbody")
    expect(setProperty(added, "collapsed", "true")).toBe(null)
    expect(setProperty(added, "collapsed", "false")).toStrictEqual({ from: 10, to: 26, insert: "collapsed:: false" })
    expect(applyEdit(added, setProperty(added, "collapsed", null) ?? { from: 0, to: 0, insert: "" })).toBe(text)
    expect(setProperty("", "id", uuid)).toStrictEqual({ from: 0, to: 0, insert: `id:: ${uuid}` })
    expect(applyEdit("a:: 1\nb:: 2", setProperty("a:: 1\nb:: 2", "a", null) ?? { from: 0, to: 0, insert: "" })).toBe("b:: 2")
  })

  it("round-trips: setting then clearing a new property restores the text", () => {
    const key = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/).filter((k) => k !== "id")
    const value = fc.stringMatching(/^[a-z0-9][a-z0-9 ]{0,10}[a-z0-9]$/)
    const text = fc.constantFrom("", "title", "TODO x\nbody", "x:: 1", "a\nb:: 2\nc")
    fc.assert(
      fc.property(text, key, value, (original, k, v) => {
        const edit = setProperty(original, k, v)
        if (edit === null || analyzeBlock(original).props[k] !== undefined) return
        const withProperty = applyEdit(original, edit)
        expect(analyzeBlock(withProperty).props[k]).toBe(v)
        const cleared = setProperty(withProperty, k, null)
        expect(cleared === null ? withProperty : applyEdit(withProperty, cleared)).toBe(original)
      }),
      { numRuns: 500 },
    )
  })
})
