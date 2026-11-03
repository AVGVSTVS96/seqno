import { describe, expect, it } from "vitest"
import { exportBlocks, type BlockOptions } from "../src/index.ts"
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
        "title:: Notes",
        "",
        "- TODO [#A] read **Dune** with [[Ada]] #books",
        "  second line *slanted*",
        "\t-",
        "\t  ```js",
        "\t  const x = 1",
        "\t    nested()",
        "\t  ```",
        "\t-",
        "\t  > a quote",
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
    ).toEqual(["- TODO [#A] read Dune with Ada ", "  second line slanted"])
  })

  it("indents with tabs alone when the style is spaces", () => {
    expect(page({ indent: "spaces", removeProperties: true }).split("\n").slice(0, 3)).toEqual([
      "TODO [#A] read **Dune** with [[Ada]] #books",
      "  second line *slanted*",
      "\t```js",
    ])
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
