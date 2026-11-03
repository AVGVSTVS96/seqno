import { assert, describe, expect, it } from "vitest"
import {
  defaultPropertyConfig,
  draftOffset,
  isSingleLine,
  joinProperties,
  pastedBlocks,
  propertyValue,
  readPropertyConfig,
  splitProperties,
  textOffset,
} from "../src/index.ts"

const tomato = "Tomato bed\nvariety:: San Marzano\nplants:: 6\nstaked on the south side"

describe("property lines while editing", () => {
  it("splits the run after the first line into props and keeps the rest as text", () => {
    assert.deepStrictEqual(splitProperties(tomato), {
      text: "Tomato bed\nstaked on the south side",
      props: [
        ["variety", "San Marzano"],
        ["plants", "6"],
      ],
      runFrom: 10,
      runTo: 43,
    })
  })

  it("joins them back to the same text, byte for byte", () => {
    const { text, props } = splitProperties(tomato)
    assert.strictEqual(joinProperties(text, props), tomato)
    assert.strictEqual(joinProperties("only props", []), "only props")
    assert.strictEqual(joinProperties("", [["type", "book"]]), "type:: book")
  })

  it("leaves lines that only look like properties in the text", () => {
    assert.deepStrictEqual(splitProperties("Title\n\nkey:: value").props, [])
    assert.deepStrictEqual(splitProperties("Title\nkey::value").props, [])
    assert.deepStrictEqual(splitProperties("```js\nkey:: value\n```").props, [])
    assert.deepStrictEqual(splitProperties("Title\na:: 1\na:: 2").props, [["a", "1"]])
    assert.deepStrictEqual(splitProperties("type:: book\nstatus:: read"), {
      text: "",
      props: [
        ["type", "book"],
        ["status", "read"],
      ],
      runFrom: 0,
      runTo: 25,
    })
  })

  it("maps caret offsets between the text and the draft", () => {
    const draft = splitProperties(tomato)
    const body = "Tomato bed\n".length
    assert.deepStrictEqual(
      [3, 10, body, body + 6].map((at) => draftOffset(draft.text, draft.props, at)),
      [3, 10, 44, 50],
    )
    assert.deepStrictEqual(
      [3, 10, 20, 43, 44, 50].map((at) => textOffset(draft, at)),
      [3, 10, 10, 10, 11, 17],
    )
  })
})

describe("pasting an outline", () => {
  it("reads a markdown outline as blocks with their children and properties", () => {
    assert.deepStrictEqual(
      pastedBlocks("- pasted one\n  - pasted child\n    note:: kept\n- pasted two"),
      [
        {
          text: "pasted one",
          props: {},
          children: [{ text: "pasted child", props: { note: "kept" }, children: [] }],
        },
        { text: "pasted two", props: {}, children: [] },
      ],
    )
    assert.deepStrictEqual(pastedBlocks("- a\n\t- b"), [
      { text: "a", props: {}, children: [{ text: "b", props: {}, children: [] }] },
    ])
  })

  it("makes one block per heading written without a bullet", () => {
    assert.deepStrictEqual(pastedBlocks("# Trip\nday one\n## Packing\n- socks"), [
      { text: "# Trip\nday one", props: {}, children: [] },
      { text: "## Packing", props: {}, children: [] },
      { text: "socks", props: {}, children: [] },
    ])
  })

  it("splits plain text into blocks at blank lines, keeping code fences whole", () => {
    assert.deepStrictEqual(pastedBlocks("line one\nline two\n\nline three\n"), [
      { text: "line one\nline two", props: {}, children: [] },
      { text: "line three", props: {}, children: [] },
    ])
    assert.deepStrictEqual(pastedBlocks("```\na\n\nb\n```\n\n\nafter"), [
      { text: "```\na\n\nb\n```", props: {}, children: [] },
      { text: "after", props: {}, children: [] },
    ])
    assert.strictEqual(pastedBlocks("\n  \n"), null)
  })

  it("leaves mixed text alone, and tells a lone line from an outline", () => {
    assert.deepStrictEqual(pastedBlocks("two\nlines"), [
      { text: "two\nlines", props: {}, children: [] },
    ])
    assert.strictEqual(isSingleLine(pastedBlocks("two\nlines") ?? []), true)
    assert.strictEqual(pastedBlocks("intro\n- a\n- b"), null)
    assert.strictEqual(isSingleLine(pastedBlocks("- just this") ?? []), true)
    assert.strictEqual(isSingleLine(pastedBlocks("- a\n- b") ?? []), false)
  })
})

const genreLinks = (config = defaultPropertyConfig) =>
  propertyValue("genre", "fiction, sci-fi", 0, config).flatMap((node) =>
    node._tag === "PageRef" ? [node.name] : [],
  )

describe("config.edn property settings", () => {
  it("reads comma-separated keys from keywords and ignored keys from strings, as Logseq 0.10.9 matches them", () => {
    const config = readPropertyConfig(
      [
        "{:meta/version 1",
        " ;; :property/separated-by-commas #{:commented}",
        ' :property/separated-by-commas #{:Genre :people "named"}',
        ' :ignored-page-references-keywords #{:author "Website"}}',
      ].join("\n"),
    )
    expect([[...config.listKeys], [...config.unparsedKeys]]).toStrictEqual([
      ["tags", "alias", "genre", "people"],
      ["website"],
    ])
    expect(readPropertyConfig("{:property/separated-by-commas [:a, :b]}").listKeys).toStrictEqual(
      new Set(["tags", "alias", "a", "b"]),
    )
    expect(readPropertyConfig("")).toStrictEqual(defaultPropertyConfig)
  })

  it("shows each value of a comma-separated key as a page link", () => {
    expect(genreLinks()).toStrictEqual([])
    expect(
      genreLinks(readPropertyConfig("{:property/separated-by-commas #{:genre}}")),
    ).toStrictEqual(["fiction", "sci-fi"])
  })
})
