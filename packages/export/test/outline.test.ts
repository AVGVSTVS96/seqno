import { describe, expect, it } from "vitest"
import { exportBlocks, type BlockOptions } from "../src/index.ts"
import { libraryOf, pageId } from "./graph.ts"

const defaults: BlockOptions = {
  indent: "dashes",
  removeBrackets: false,
  removeEmphasis: false,
  removeTags: false,
  removeProperties: false,
  newlineAfterBlock: false,
  level: null,
}

const library = libraryOf({
  "Reading list": `type:: list

- TODO [#A] read **Dune** & [[Ada]] #books
  id:: 61506710-484c-46d5-9983-3d1651ec02c8
  second "line"
	- see ((61506710-484c-46d5-9983-3d1651ec02c8)) at [site](https://example.com/a?b=1&c=2)
	- \`\`\`js
	  if (a < b) go()
	  \`\`\`
- ==bright== and \`code\``,
})

const page = (format: "opml" | "html", options: Partial<BlockOptions> = {}) =>
  exportBlocks(library, { _tag: "Page", pageId: pageId(1) }, format, { ...defaults, ...options })

describe("OPML export", () => {
  it("writes one outline per block, the body joined onto its text", () => {
    expect(page("opml")).toBe(
      [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<opml version="2.0">`,
        `  <head>`,
        `    <title>Reading list</title>`,
        `  </head>`,
        `  <body>`,
        `    <outline text="TODO [#A] read **Dune** &amp; [[Ada]] #books second &quot;line&quot;">`,
        `      <outline text="see read **Dune** &amp; [[Ada]] #books at [site](https://example.com/a?b=1&amp;c=2)"/>`,
        `      <outline text="if (a &lt; b) go()"/>`,
        `    </outline>`,
        `    <outline text="^^bright^^ and \`code\`"/>`,
        `  </body>`,
        `</opml>`,
        ``,
      ].join("\n"),
    )
  })

  it("applies the same removals as text", () => {
    expect(
      page("opml", { removeBrackets: true, removeEmphasis: true, removeTags: true, level: 1 }),
    ).toContain(`<outline text="TODO [#A] read Dune &amp; Ada second &quot;line&quot;"/>`)
  })

  it("titles blocks untitled, as Logseq does", () => {
    const [first] = library.pages[0]?.blocks ?? []
    expect(
      exportBlocks(
        library,
        { _tag: "Blocks", blockIds: first === undefined ? [] : [first.id] },
        "opml",
        defaults,
      ),
    ).toContain("<title>untitled</title>")
  })
})

describe("HTML export", () => {
  it("nests lists and maps inline marks to tags", () => {
    expect(page("html")).toBe(
      [
        `<ul>`,
        `  <li>TODO [#A] read <b>Dune</b> &amp; <a>[[Ada]]</a> <a>#books</a>`,
        `    <p>second &quot;line&quot;</p>`,
        `    <ul>`,
        `      <li>see read <b>Dune</b> &amp; <a>[[Ada]]</a> <a>#books</a> at <a href="https://example.com/a?b=1&amp;c=2">site</a></li>`,
        `      <li>`,
        `        <pre data-lang="js">if (a &lt; b) go()</pre>`,
        `      </li>`,
        `    </ul>`,
        `  </li>`,
        `  <li><mark>bright</mark> and <code>code</code></li>`,
        `</ul>`,
        ``,
      ].join("\n"),
    )
  })

  it("drops brackets and tags when asked", () => {
    expect(page("html", { removeBrackets: true, removeTags: true, level: 1 }).split("\n")[1]).toBe(
      `  <li>TODO [#A] read <b>Dune</b> &amp; Ada `,
    )
  })
})
