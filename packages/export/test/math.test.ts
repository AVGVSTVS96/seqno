import { describe, expect, it } from "vitest"
import { exportBlocks, type BlockOptions } from "../src/index.ts"
import { libraryOf, pageId } from "./graph.ts"

const library = libraryOf({
  math: `- a$x$b and \\(y\\) and $$z$$ end
- $x$ starts`,
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

const page = { _tag: "Page", pageId: pageId(1) } as const

describe("math in exports, as Logseq 0.10.9's exporter writes it", () => {
  it("writes inline math as $…$ or $$…$$ with a space on each side in text", () => {
    expect(exportBlocks(library, page, "text", defaults)).toBe(
      "- a $x$ b and $y$ and $$z$$ end\n- $x$ starts\n",
    )
  })

  it("wraps inline math in a span in HTML", () => {
    expect(exportBlocks(library, page, "html", defaults)).toBe(
      [
        "<ul>",
        "  <li>a<span>$x$</span>b and <span>$y$</span> and <span>$$z$$</span> end</li>",
        "  <li><span>$x$</span> starts</li>",
        "</ul>",
      ].join("\n"),
    )
  })

  it("writes inline math the same way in OPML", () => {
    expect(exportBlocks(library, page, "opml", defaults)).toContain(
      '<outline text="a $x$ b and $y$ and $$z$$ end"/>',
    )
  })
})
