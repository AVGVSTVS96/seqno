import { describe, expect, it } from "vitest"
import { exportBlocks } from "../src/index.ts"
import type { BlockOptions } from "../src/index.ts"
import { blockOf, libraryOf, pageId } from "./graph.ts"

const logseq = libraryOf({
  page1: `- 1
  id:: 61506710-484c-46d5-9983-3d1651ec02c8
	- 2
	  id:: 61506711-5638-4899-ad78-187bdc2eaffc
		- 3
		  id:: 61506712-3007-407e-b6d3-d008a8dfa88b
		- ((61506712-3007-407e-b6d3-d008a8dfa88b))
- 4
  id:: 61506712-b8a7-491d-ad84-b71651c3fdab`,
  page2: `- 3
  id:: 97a00e55-48c3-48d8-b9ca-417b16e3a616
	- {{embed [[page1]]}}`,
})

const defaults: BlockOptions = {
  indent: "dashes",
  removeBrackets: false,
  removeEmphasis: false,
  removeTags: false,
  removeProperties: false,
  newlineAfterBlock: false,
  level: null,
}

const one = blockOf(logseq, "1")
const three = logseq.pages[1]?.blocks[0]?.id ?? one

const text = (options: Partial<BlockOptions>, target = one) =>
  exportBlocks(logseq, { _tag: "Blocks", blockIds: [target] }, "text", { ...defaults, ...options })

describe("text export, against Logseq's own export tests", () => {
  it("drops properties and replaces block refs with the block they point to", () => {
    expect(text({ removeProperties: true })).toBe("- 1\n\t- 2\n\t\t- 3\n\t\t- 3\n")
  })

  it("puts an embedded page's blocks where the embed was", () => {
    expect(text({ removeProperties: true }, three)).toBe(
      "- 3\n\t- 1\n\t\t- 2\n\t\t\t- 3\n\t\t\t- 3\n\t- 4\n",
    )
  })

  it("keeps id:: lines when properties stay", () => {
    expect(text({})).toBe(
      [
        "- 1",
        "  id:: 61506710-484c-46d5-9983-3d1651ec02c8",
        "\t- 2",
        "\t  id:: 61506711-5638-4899-ad78-187bdc2eaffc",
        "\t\t- 3",
        "\t\t  id:: 61506712-3007-407e-b6d3-d008a8dfa88b",
        "\t\t- 3",
        "",
      ].join("\n"),
    )
  })

  it("keeps only blocks up to a level", () => {
    expect(text({ removeProperties: true, level: 2 }, three)).toBe("- 3\n\t- 1\n\t- 4\n")
  })

  it("puts a blank line after each block", () => {
    expect(text({ removeProperties: true, newlineAfterBlock: true })).toBe(
      "- 1\n\n\t- 2\n\n\t\t- 3\n\n\t\t- 3\n",
    )
  })

  it("exports a whole page", () => {
    expect(
      exportBlocks(logseq, { _tag: "Page", pageId: pageId(1) }, "text", {
        ...defaults,
        removeProperties: true,
      }),
    ).toBe("- 1\n\t- 2\n\t\t- 3\n\t\t- 3\n- 4\n")
  })
})

describe("text export options", () => {
  const notes = libraryOf({
    notes: `title:: Notes

- TODO [#A] read **Dune** with [[Ada]] #books
  second line *slanted*
	- \`\`\`js
	  const x = 1
	    nested()
	  \`\`\`
	- > a quote
	- spaced
	  more`,
  })

  const page = (options: Partial<BlockOptions>) =>
    exportBlocks(notes, { _tag: "Page", pageId: pageId(1) }, "text", { ...defaults, ...options })

  it("writes the page's properties first, then the blocks as Logseq would", () => {
    expect(page({})).toBe(
      [
        "  title:: Notes",
        "  ",
        "- TODO [#A] read **Dune** with [[Ada]] #books",
        "  second line *slanted*  ",
        "\t-",
        "\t  ```js",
        "\t  const x = 1",
        "\t    nested()",
        "\t  ```",
        "\t-",
        "\t  > a quote  ",
        "\t- spaced",
        "\t  more",
        "",
      ].join("\n"),
    )
  })

  it("removes brackets, emphasis and tags", () => {
    expect(
      page({ removeBrackets: true, removeEmphasis: true, removeTags: true, removeProperties: true })
        .split("\n")
        .slice(0, 2),
    ).toEqual(["- TODO [#A] read Dune with Ada ", "  second line slanted  "])
  })

  it("indents with tabs alone when the style is spaces", () => {
    expect(page({ indent: "spaces" })).toBe(
      [
        "title:: Notes",
        "  ",
        "TODO [#A] read **Dune** with [[Ada]] #books",
        "  second line *slanted*  ",
        "\t```js",
        "\t  const x = 1",
        "\t    nested()",
        "\t```",
        "\t> a quote  ",
        "\tspaced",
        "\t  more",
        "",
      ].join("\n"),
    )
  })

  it("reads a table's first row as its header and writes autolinks bare, as Logseq does", () => {
    const loose = libraryOf({ loose: "- see <https://example.com/a>\n  | a | b |\n  | 1 | 2 |" })
    expect(exportBlocks(loose, { _tag: "Page", pageId: pageId(1) }, "text", defaults)).toBe(
      "- see https://example.com/a\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n",
    )
  })

  it("writes lists and tables inside a block as Logseq's standard Markdown does", () => {
    const shaped = libraryOf({
      shaped: [
        "- Steps",
        "  1. water",
        "  2. lift",
        "     1. loosen",
        "  * [ ] buy",
        "  * [x] wash",
        "  and after",
        "- | Bed | Crop |",
        "  | --- | :-: |",
        "  | 1 | **Garlic** |",
        "- ==mark== ***both*** _it_ {{cloze hidden}}",
        "  last line",
      ].join("\n"),
    })

    expect(exportBlocks(shaped, { _tag: "Page", pageId: pageId(1) }, "text", defaults)).toBe(
      [
        "- Steps",
        "\t1. water",
        "\t2. lift",
        "\t\t1. loosen",
        "\t* [ ] buy",
        "\t* [X] wash  ",
        "and after",
        "",
        "-",
        "  | Bed | Crop |",
        "  |---|---|",
        "  | 1 | **Garlic** |",
        "- ^^mark^^ *__both__* *it* hidden",
        "  last line",
        "",
      ].join("\n"),
    )
  })

  it("drops every indent with no-indent, but keeps the code's own", () => {
    expect(page({ indent: "no-indent", removeProperties: true })).toBe(
      [
        "TODO [#A] read **Dune** with [[Ada]] #books",
        "second line *slanted*",
        "```js",
        "const x = 1",
        "  nested()",
        "```",
        "> a quote",
        "spaced",
        "more",
        "",
      ].join("\n"),
    )
  })
})

describe("a front matter page", () => {
  const base = libraryOf({ notes: "- Pressed three ferns\n\t- the third one" })

  const front = {
    ...base,
    pages: base.pages.map((entry) => ({
      ...entry,
      page: { ...entry.page, props: { title: "Notes", rating: "4" }, frontMatter: true as const },
    })),
  }

  const page = (format: "text" | "opml" | "html", indent: BlockOptions["indent"] = "dashes") =>
    exportBlocks(front, { _tag: "Page", pageId: pageId(1) }, format, { ...defaults, indent })

  it("leaves its front matter out, as Logseq does, keeping the two breaks it leaves", () => {
    expect(page("text")).toBe("  \n  \n- Pressed three ferns\n\t- the third one\n")
    expect(page("text", "no-indent")).toBe("\n\nPressed three ferns\nthe third one\n")
    expect(page("opml")).toContain(`<body>\n    <outline text=" "/>\n    <outline text="Pressed`)
    expect(page("html")).toBe(
      "<ul>\n  <li>Pressed three ferns</li>\n  <ul>\n    <li>the third one</li>\n  </ul>\n</ul>",
    )
  })
})
