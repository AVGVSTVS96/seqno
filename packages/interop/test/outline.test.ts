import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { LogseqSyntax, LogseqSyntaxLive, type OutlineBlock } from "@seqno/interop"

const syntax = Effect.runSync(
  Effect.provide(
    Effect.gen(function* () {
      return yield* LogseqSyntax
    }),
    LogseqSyntaxLive,
  ),
)

const parse = (source: string) => syntax.parse(source)

const roundTrip = (source: string) => syntax.print(syntax.parse(source))

const orgBlock = (
  text: string,
  children: ReadonlyArray<OutlineBlock> = [],
  props = {},
): OutlineBlock => ({
  text,
  props,
  collapsed: false,
  children,
})

describe("outline syntax", () => {
  it("splits page properties, block properties, collapsed and children", () => {
    const source = [
      "title:: Project X",
      "tags:: work, q4",
      "",
      "- Plan **now**",
      "  owner:: [[Ana]]",
      "  id:: 01920000-0000-7000-8000-000000000001",
      "  collapsed:: true",
      "  second line",
      "\t- step one",
      "\t\t- deep",
      "- icon:: rocket",
      "-",
    ].join("\n")
    assert.deepStrictEqual(parse(source), {
      props: { title: "Project X", tags: "work, q4" },
      blocks: [
        {
          text: "Plan **now**\nsecond line",
          props: { owner: "[[Ana]]", id: "01920000-0000-7000-8000-000000000001" },
          collapsed: true,
          children: [
            {
              text: "step one",
              props: {},
              collapsed: false,
              children: [{ text: "deep", props: {}, collapsed: false, children: [] }],
            },
          ],
        },
        { text: "", props: { icon: "rocket" }, collapsed: false, children: [] },
        { text: "", props: {}, collapsed: false, children: [] },
      ],
    })
    assert.strictEqual(roundTrip(source), source)
  })

  it("reads each heading outside a bullet as its own block, and writes a first heading bare as Logseq does", () => {
    const source =
      "# Title\nid:: 6512a0c4-1111-4222-8333-444455556666\n\t- child\n## Next\nbody\n- a"
    assert.deepStrictEqual(parse(source), {
      props: {},
      blocks: [
        {
          text: "# Title",
          props: { id: "6512a0c4-1111-4222-8333-444455556666" },
          collapsed: false,
          children: [{ text: "child", props: {}, collapsed: false, children: [] }],
        },
        { text: "## Next\nbody", props: {}, collapsed: false, children: [] },
        { text: "a", props: {}, collapsed: false, children: [] },
      ],
    })
    assert.strictEqual(
      roundTrip(source),
      "# Title\nid:: 6512a0c4-1111-4222-8333-444455556666\n\t- child\n- ## Next\n  body\n- a",
    )
    assert.strictEqual(roundTrip("# Title\n- a\n- b"), "# Title\n- a\n- b")
    assert.strictEqual(roundTrip("title:: T\n\n# First\ntext"), "title:: T\n\n- # First\n  text")
    assert.strictEqual(roundTrip("- # One\n  # Two"), "# One\n- # Two")
    assert.strictEqual(roundTrip("# One\n  indented"), "# One\nindented")
    assert.strictEqual(roundTrip("- # One\n    code"), "- # One\n    code")
  })

  it("keeps dash lines inside a fenced code block as block text", () => {
    const source = ["- code:", "  ```md", "  - not a block", "  ```", "- next"].join("\n")
    assert.deepStrictEqual(
      parse(source).blocks.map((block) => block.text),
      ["code:\n```md\n- not a block\n```", "next"],
    )
    assert.strictEqual(roundTrip(source), source)
  })

  it("keeps a bare bullet whose content starts on the next line", () => {
    const source = [
      "-",
      "  #+BEGIN_TIP",
      "  backlinks open the page",
      "  #+END_TIP",
      "- next",
    ].join("\n")
    assert.deepStrictEqual(
      parse(source).blocks.map((block) => block.text),
      ["\n#+BEGIN_TIP\nbacklinks open the page\n#+END_TIP", "next"],
    )
    assert.strictEqual(roundTrip(source), source)
  })

  it("ends an unclosed fence at the next sibling bullet", () => {
    assert.deepStrictEqual(
      parse("- ```\n  open\n- sibling").blocks.map((block) => block.text),
      ["```\nopen", "sibling"],
    )
  })

  it("reads two-space indentation and keeps unknown syntax verbatim", () => {
    const source = [
      "- {{embed [[other]]}}",
      "  - :LOGBOOK:",
      "    CLOCK: [2026-10-06 Tue 09:00]",
      "    :END:",
      "  - #+BEGIN_QUOTE",
      "    x:: not a property here",
      "    #+END_QUOTE",
    ].join("\n")
    const [embed] = parse(source).blocks
    assert.deepStrictEqual(
      embed?.children.map((child) => [child.text, child.props]),
      [
        [":LOGBOOK:\nCLOCK: [2026-10-06 Tue 09:00]\n:END:", {}],
        ["#+BEGIN_QUOTE\nx:: not a property here\n#+END_QUOTE", {}],
      ],
    )
  })

  it("keeps leading text that is not page properties as a first block", () => {
    assert.deepStrictEqual(parse("intro line\n- a"), {
      props: {},
      blocks: [
        { text: "intro line", props: {}, collapsed: false, children: [] },
        { text: "a", props: {}, collapsed: false, children: [] },
      ],
    })
  })

  it("reads YAML front matter as page properties and writes it back as Logseq does", () => {
    const source =
      '---\ntitle: FM Title\ntags: [alpha, beta]\nAuthor_Name: Jane Doe\nquoted: "a: b"\nb:c\n---\n- one\n\t- two'
    assert.deepStrictEqual(parse(source), {
      props: {
        title: "FM Title",
        tags: "[alpha, beta]",
        Author_Name: "Jane Doe",
        quoted: '"a: b"',
        b: "c",
      },
      blocks: [
        {
          text: "one",
          props: {},
          collapsed: false,
          children: [{ text: "two", props: {}, collapsed: false, children: [] }],
        },
      ],
      frontMatter: true,
    })
    assert.strictEqual(
      roundTrip(source),
      '---\ntitle: FM Title\ntags: [alpha, beta]\nAuthor_Name: Jane Doe\nquoted: "a: b"\nb: c\n---\n\n- one\n\t- two',
    )
    assert.strictEqual(roundTrip("---\na: x\n---"), "---\na: x\n---")
  })

  it("keeps front matter Logseq can't read as the first block's text", () => {
    for (const source of [
      "---\ntags:\n  - a\n---\n- one",
      "---\n\na: x\n---\n- one",
      "\n---\na: x\n---\n- one",
      "+++\na = 1\n+++\n- one",
    ]) {
      const outline = parse(source)
      assert.deepStrictEqual(
        [outline.props, outline.frontMatter, outline.blocks.length],
        [{}, undefined, 2],
      )
    }
  })

  it("lets front matter win over key:: lines below it, keeping those lines as a block", () => {
    assert.deepStrictEqual(parse("---\nfoo: bar\n---\ntype:: book\n\n- b"), {
      props: { foo: "bar" },
      blocks: [
        { text: "", props: { type: "book" }, collapsed: false, children: [] },
        { text: "b", props: {}, collapsed: false, children: [] },
      ],
      frontMatter: true,
    })
  })

  it("reads an Org file's headings, drawers and #+ lines as Logseq does, and writes it back", () => {
    const source = [
      "#+TITLE: Org Page",
      "#+TAGS: orgtag",
      "",
      "* TODO first [#A] heading",
      ":PROPERTIES:",
      ":id: 6512a0c4-1111-4222-8333-444455556666",
      ":custom: val",
      ":END:",
      "body *bold* /it/",
      "** child",
      "**** skipped",
      "* second",
      "SCHEDULED: <2026-11-03 Tue>",
      ":PROPERTIES:",
      ":fresh: prop",
      ":END:",
      "#+BEGIN_SRC js",
      "* not a heading",
      "#+END_SRC",
      "* collapsed one",
      ":PROPERTIES:",
      ":collapsed: true",
      ":END:",
      "** hidden kid",
      "*",
    ].join("\n")
    assert.deepStrictEqual(syntax.parse(source, "org"), {
      props: { TITLE: "Org Page", TAGS: "orgtag" },
      blocks: [
        orgBlock(
          "TODO first [#A] heading\nbody *bold* /it/",
          [orgBlock("child", [orgBlock("skipped")])],
          {
            id: "6512a0c4-1111-4222-8333-444455556666",
            custom: "val",
          },
        ),
        orgBlock(
          "second\nSCHEDULED: <2026-11-03 Tue>\n#+BEGIN_SRC js\n* not a heading\n#+END_SRC",
          [],
          { fresh: "prop" },
        ),
        { ...orgBlock("collapsed one", [orgBlock("hidden kid")]), collapsed: true },
        orgBlock(""),
      ],
      format: "org",
    })
    assert.strictEqual(
      syntax.print(syntax.parse(source, "org")),
      source.replace("**** skipped", "*** skipped"),
    )
  })

  it("reads text before the first Org heading as a first block, and front matter in Org", () => {
    assert.deepStrictEqual(
      syntax.parse("before text\n* a", "org").blocks.map((block) => block.text),
      ["before text", "a"],
    )
    const front = syntax.parse("---\ntitle: Y\n---\n* a", "org")
    assert.deepStrictEqual([front.props, front.frontMatter], [{ title: "Y" }, true])
    assert.strictEqual(syntax.print(front), "---\ntitle: Y\n---\n\n* a")
    assert.deepStrictEqual(syntax.parse(":PROPERTIES:\n:title: X\n:END:\n* a", "org").props, {
      title: "X",
    })
  })
})
