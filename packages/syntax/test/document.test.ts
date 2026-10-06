import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { type Block, type Outline, parse, print, render, toOutline } from "../src/index.ts"

const read = (source: string) => toOutline(parse(source))

const page = [
  "title:: My Page",
  "alias:: mp, other",
  "",
  "- TODO [#A] write spec",
  "  SCHEDULED: <2024-01-15 Mon .+1w>",
  "  id:: 650e8f2a-1b2c-4d5e-8f90-123456789abc",
  "  :LOGBOOK:",
  "  CLOCK: [2024-01-10 Wed 09:00:00]--[2024-01-10 Wed 09:30:00] =>  00:30:00",
  "  :END:",
  "\t- child with [[Page Ref]] and #tag",
  "\t  collapsed:: true",
  "\t\t- grandchild ((650e8f2a-1b2c-4d5e-8f90-123456789abc))",
  "- ```js",
  "  - not a block",
  "  ```",
  "- #+BEGIN_QUERY",
  '  {:title "x"',
  "  - :query [:find ?b]}",
  "  #+END_QUERY",
  "-",
  "- ",
  "  ",
  "  second paragraph",
].join("\n")

describe("parse and print", () => {
  it("reads a Logseq page into an outline", () => {
    expect(read(page)).toStrictEqual({
      preamble: "title:: My Page\nalias:: mp, other\n\n",
      blocks: [
        {
          text: [
            "TODO [#A] write spec",
            "SCHEDULED: <2024-01-15 Mon .+1w>",
            "id:: 650e8f2a-1b2c-4d5e-8f90-123456789abc",
            ":LOGBOOK:",
            "CLOCK: [2024-01-10 Wed 09:00:00]--[2024-01-10 Wed 09:30:00] =>  00:30:00",
            ":END:",
          ].join("\n"),
          children: [
            {
              text: "child with [[Page Ref]] and #tag\ncollapsed:: true",
              children: [{ text: "grandchild ((650e8f2a-1b2c-4d5e-8f90-123456789abc))", children: [] }],
            },
          ],
        },
        { text: "```js\n- not a block\n```", children: [] },
        { text: '#+BEGIN_QUERY\n{:title "x"\n- :query [:find ?b]}\n#+END_QUERY', children: [] },
        { text: "", children: [] },
        { text: "\n\nsecond paragraph", children: [] },
      ],
      format: { indent: "\t", eol: "\n", finalNewline: false, bom: false },
    })
  })

  it("renders a Logseq page back to the same bytes", () => {
    expect(render(read(page))).toBe(page)
    expect(print(parse(page))).toBe(page)
  })

  it("keeps CRLF, BOM, final newline and two-space indentation", () => {
    const source = "﻿title:: x\r\n\r\n- a\r\n  - b\r\n    more\r\n"
    expect(read(source)).toStrictEqual({
      preamble: "title:: x\n\n",
      blocks: [{ text: "a", children: [{ text: "b\nmore", children: [] }] }],
      format: { indent: "  ", eol: "\r\n", finalNewline: true, bom: true },
    })
    expect(render(read(source))).toBe(source)
  })

  it("keeps YAML front matter lists out of the block tree", () => {
    expect(read("---\ntags:\n  - a\n---\n- block")).toStrictEqual({
      preamble: "---\ntags:\n  - a\n---\n",
      blocks: [{ text: "block", children: [] }],
      format: { indent: "\t", eol: "\n", finalNewline: false, bom: false },
    })
  })

  it("closes an unterminated fence at the next sibling bullet", () => {
    expect(read("- ```\n  code\n\t- swallowed\n- sibling").blocks).toStrictEqual([
      { text: "```\ncode\n\t- swallowed", children: [] },
      { text: "sibling", children: [] },
    ])
  })

  it("treats a file without bullets as preamble only", () => {
    expect(read("just text\n# heading")).toStrictEqual({
      preamble: "just text\n# heading",
      blocks: [],
      format: { indent: "\t", eol: "\n", finalNewline: false, bom: false },
    })
    expect(read("")).toStrictEqual({
      preamble: "",
      blocks: [],
      format: { indent: "\t", eol: "\n", finalNewline: false, bom: false },
    })
  })

  it("nests by indentation width, not by indentation characters", () => {
    expect(read("- a\n    - b\n  - c\n- d").blocks).toStrictEqual([
      {
        text: "a",
        children: [
          { text: "b", children: [] },
          { text: "c", children: [] },
        ],
      },
      { text: "d", children: [] },
    ])
  })

  it("keeps the 50k-line flat file shape without recursion limits", () => {
    const source = Array.from({ length: 50_000 }, (_, i) => `- block ${i}`).join("\n")
    const outline = read(source)
    expect(outline.blocks.length).toBe(50_000)
    expect(outline.blocks[49_999]).toStrictEqual({ text: "block 49999", children: [] })
    expect(render(outline)).toBe(source)
  })
})

const tricky = fc.constantFrom(
  "-",
  "- ",
  " ",
  "\t",
  "\n",
  "\r\n",
  "\r",
  "```",
  "~~~",
  "#+BEGIN_QUERY",
  "#+END_QUERY",
  "---",
  "﻿",
  "a",
  "key:: v",
  "[[x]]",
  "  ",
  ":LOGBOOK:",
  ":END:",
)

describe("properties", () => {
  it("prints every input byte-for-byte", () => {
    fc.assert(
      fc.property(fc.oneof(fc.array(tricky, { maxLength: 40 }).map((parts) => parts.join("")), fc.string({ unit: "binary" })), (source) => {
        expect(print(parse(source))).toBe(source)
      }),
      { numRuns: 3000 },
    )
  })

  const plainLine = fc.oneof(
    fc.constantFrom(
      "",
      "  indented",
      "\tcode",
      "key:: value",
      "SCHEDULED: <2024-01-01 Mon>",
      ":LOGBOOK:",
      ":END:",
      "text with [[ref]] and #tag",
      "* star item",
      "-- dash",
    ),
    fc.string({ unit: fc.constantFrom("a", " ", "#", "[", "]", "(", ")", ":") }),
  )
  const fenced = fc
    .tuple(fc.constantFrom("```", "~~~", "```js"), fc.array(fc.constantFrom("- inside", "  - deeper", "", "x"), { maxLength: 3 }))
    .map(([open, body]) => [open, ...body, open.slice(0, 3)])
  const text = fc
    .tuple(fc.string({ unit: fc.constantFrom("a", " ", "-", "\t", "#") }), fc.array(fc.oneof(plainLine.map((line) => [line]), fenced), { maxLength: 4 }))
    .map(([first, groups]) => [first, ...groups.flat()].join("\n"))

  const tree: fc.Arbitrary<ReadonlyArray<Block>> = fc.letrec<{ blocks: ReadonlyArray<Block> }>((self) => ({
    blocks: fc.array(
      fc.record(
        { text, children: fc.oneof({ depthSize: "small", withCrossShrink: true }, fc.constant([]), self("blocks")) },
        { noNullPrototype: true },
      ),
      { maxLength: 4 },
    ),
  })).blocks

  const outline: fc.Arbitrary<Outline> = fc.record({
    preamble: fc.constantFrom("", "title:: Foo\n", "title:: Foo\nalias:: bar\n\n", "---\ntitle: x\n---\n", "\n"),
    blocks: tree.filter((blocks) => blocks.length > 0),
    format: fc.record({
      indent: fc.constantFrom("\t", "  ", "    "),
      eol: fc.constantFrom<"\n" | "\r\n">("\n", "\r\n"),
      finalNewline: fc.boolean(),
      bom: fc.boolean(),
    }),
  })

  it("reads back every outline it renders", () => {
    fc.assert(
      fc.property(outline, (original) => {
        const nested = original.blocks.some((block) => block.children.length > 0)
        const source = render(original)
        const format = {
          ...original.format,
          indent: nested ? original.format.indent : "\t",
          eol: source.includes("\n") ? original.format.eol : "\n",
        }
        const expected = { ...original, format }
        expect(read(source)).toStrictEqual(expected)
        expect(render(read(source))).toBe(source)
      }),
      { numRuns: 2000 },
    )
  })
})
