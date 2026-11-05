import { describe, expect, it } from "vitest"
import { exportBlocks } from "../src/index.ts"
import type { BlockOptions } from "../src/index.ts"
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
        `    <title>reading list</title>`,
        `  </head>`,
        `  <body>`,
        `    <outline text="TODO [#A] read **Dune** &amp; [[Ada]] #books second &quot;line&quot;">`,
        `      <outline text="see read **Dune** &amp; [[Ada]] #books at [site](https://example.com/a?b=1&amp;c=2)"/>`,
        `      <outline text="if (a &lt; b) go()"/>`,
        `    </outline>`,
        `    <outline text="^^bright^^ and \`code\`"/>`,
        `  </body>`,
        `</opml>`,
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
  it("puts child blocks in a list after their item and maps inline marks to tags, as Logseq does", () => {
    expect(page("html")).toBe(
      [
        `<ul>`,
        `  <li>TODO [#A] read <b>Dune</b> &amp; <a>[[Ada]]</a> <a>#books</a><p>second "line"<br/></p></li>`,
        `  <ul>`,
        `    <li>see read <b>Dune</b> &amp; <a>[[Ada]]</a> <a>#books</a> at <a href="https://example.com/a?b=1&amp;c=2">site</a></li>`,
        `    <li>`,
        `      <pre data-lang="js">if (a &lt; b) go()`,
        `</pre>`,
        `    </li>`,
        `  </ul>`,
        `  <li><mark>bright</mark> and <code>code</code></li>`,
        `</ul>`,
      ].join("\n"),
    )
  })

  it("drops brackets and tags when asked", () => {
    expect(page("html", { removeBrackets: true, removeTags: true, level: 1 }).split("\n")[1]).toBe(
      `  <li>TODO [#A] read <b>Dune</b> &amp; Ada <p>second "line"<br/></p></li>`,
    )
  })

  it("writes lists, tables, rules and footnotes inside a block", () => {
    const shaped = libraryOf({
      shaped: [
        "- Steps",
        "  1. water",
        "     * deep",
        "  ---",
        "  see[^1]",
        "  [^1]: the note",
        "- | Bed | Crop |",
        "  | --- | --- |",
        "  | 1 | **Garlic** |",
        "-",
      ].join("\n"),
    })

    expect(exportBlocks(shaped, { _tag: "Page", pageId: pageId(1) }, "html", defaults)).toBe(
      [
        `<ul>`,
        `  <li>Steps<hr/><p>see<sup><a href="#fnd.1">1</a></sup><br/></p><div>the note<sup id="fnd.1">1↩</sup></div></li>`,
        `  <ul>`,
        `    <li>`,
        `      <p>water</p>`,
        `    </li>`,
        `    <ul>`,
        `      <li>`,
        `        <p>deep</p>`,
        `      </li>`,
        `    </ul>`,
        `  </ul>`,
        `  <li>`,
        `    <table style="width:100%">`,
        `      <tr>`,
        `        <th>Bed</th>`,
        `        <th>Crop</th>`,
        `      </tr>`,
        `      <tr>`,
        `        <td>1</td>`,
        `        <td>`,
        `          <b>Garlic</b>`,
        `        </td>`,
        `      </tr>`,
        `    </table>`,
        `  </li>`,
        `  <li/>`,
        `</ul>`,
      ].join("\n"),
    )
    expect(exportBlocks(shaped, { _tag: "Page", pageId: pageId(1) }, "opml", defaults)).toContain(
      [
        `    <outline text="Steps see[^1] [^1]: the note">`,
        `      <outline text="water">`,
        `        <outline text="deep"/>`,
        `      </outline>`,
        `    </outline>`,
        `    <outline text=""/>`,
        `    <outline text=""/>`,
      ].join("\n"),
    )
  })
})
