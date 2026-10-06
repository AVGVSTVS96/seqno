import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { LogseqSyntax, LogseqSyntaxLive } from "@seqno/interop"

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
})
