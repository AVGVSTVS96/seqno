import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { exportGraph } from "../src/index.ts"
import { pageId, pagesOf } from "./graph.ts"

const pages = pagesOf({
  Ada: `alias:: Countess

- DONE wrote the "notes"
  id:: 61506710-484c-46d5-9983-3d1651ec02c8
  collapsed:: true
	- child`,
  Babbage: `- met ((61506710-484c-46d5-9983-3d1651ec02c8))
	- {{embed [[Ada]]}}`,
  Empty: ``,
})

const options = {
  graph: "demo",
  seconds: 1_761_120_000,
  path: (page: { readonly title: string }) => `pages/${page.title}.md`,
}

const text = (format: "edn" | "json" | "roam-json") =>
  strFromU8(exportGraph(pages, format, options).bytes)

const block = (n: number) => `01901000-0000-7000-8000-${String(n).padStart(12, "0")}`

describe("graph export", () => {
  it("writes EDN in Logseq's shape, which its EDN import reads", () => {
    expect(exportGraph(pages, "edn", options).name).toBe("demo_1761120000.edn")
    expect(text("edn")).toBe(
      [
        `{:version 1,`,
        ` :blocks`,
        ` [{:block/id #uuid "${pageId(1)}",`,
        `   :block/page-name "Ada",`,
        `   :block/properties`,
        `   {:alias "Countess"},`,
        `   :block/format :markdown,`,
        `   :block/children`,
        `   [{:block/id #uuid "e1ec9c62-9b7c-47ca-8467-4745f4029093",`,
        `     :block/properties`,
        `     {:alias "Countess"},`,
        `     :block/format :markdown,`,
        `     :block/content "",`,
        `     :block/children`,
        `     []}`,
        `    {:block/id #uuid "61506710-484c-46d5-9983-3d1651ec02c8",`,
        `     :block/properties`,
        `     {:collapsed "true"},`,
        `     :block/format :markdown,`,
        `     :block/content "DONE wrote the \\"notes\\"",`,
        `     :block/children`,
        `     [{:block/id #uuid "${block(2)}",`,
        `       :block/properties nil,`,
        `       :block/format :markdown,`,
        `       :block/content "child",`,
        `       :block/children`,
        `       []}]}]}`,
        `  {:block/id #uuid "${pageId(2)}",`,
        `   :block/page-name "Babbage",`,
        `   :block/properties nil,`,
        `   :block/format :markdown,`,
        `   :block/children`,
        `   [{:block/id #uuid "${block(3)}",`,
        `     :block/properties nil,`,
        `     :block/format :markdown,`,
        `     :block/content "met ((61506710-484c-46d5-9983-3d1651ec02c8))",`,
        `     :block/children`,
        `     [{:block/id #uuid "${block(4)}",`,
        `       :block/properties nil,`,
        `       :block/format :markdown,`,
        `       :block/content "{{embed [[Ada]]}}",`,
        `       :block/children`,
        `       []}]}]}]}`,
        ``,
      ].join("\n"),
    )
  })

  it("writes JSON with the same tree", () => {
    const parsed: unknown = JSON.parse(text("json"))
    expect(parsed).toEqual({
      version: 1,
      blocks: [
        {
          id: pageId(1),
          "page-name": "Ada",
          properties: { alias: "Countess" },
          format: "markdown",
          children: [
            {
              id: "e1ec9c62-9b7c-47ca-8467-4745f4029093",
              properties: { alias: "Countess" },
              format: "markdown",
              content: "",
              children: [],
            },
            {
              id: "61506710-484c-46d5-9983-3d1651ec02c8",
              properties: { collapsed: "true" },
              format: "markdown",
              content: 'DONE wrote the "notes"',
              children: [
                {
                  id: block(2),
                  properties: null,
                  format: "markdown",
                  content: "child",
                  children: [],
                },
              ],
            },
          ],
        },
        {
          id: pageId(2),
          "page-name": "Babbage",
          properties: null,
          format: "markdown",
          children: [
            {
              id: block(3),
              properties: null,
              format: "markdown",
              content: "met ((61506710-484c-46d5-9983-3d1651ec02c8))",
              children: [
                {
                  id: block(4),
                  properties: null,
                  format: "markdown",
                  content: "{{embed [[Ada]]}}",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it("writes Roam JSON with uids only on referenced blocks", () => {
    expect(JSON.parse(text("roam-json"))).toEqual([
      {
        title: "Ada",
        children: [
          { string: "alias:: Countess" },
          {
            string: '{{[[DONE]]}} wrote the "notes"',
            uid: "Z6Sc4cYrc",
            children: [{ string: "child" }],
          },
        ],
      },
      {
        title: "Babbage",
        children: [{ string: "met ((Z6Sc4cYrc))", children: [{ string: "{{embed: [[Ada]]}}" }] }],
      },
    ])
  })

  it("zips one standard Markdown file per page, properties kept as Logseq does", () => {
    const file = exportGraph(pages, "markdown", options)
    expect(file.name).toBe("demo_markdown_1761120000.zip")
    const files = Object.fromEntries(
      Object.entries(unzipSync(file.bytes)).map(([path, bytes]) => [path, strFromU8(bytes)]),
    )
    expect(files).toEqual({
      "demo_markdown_1761120000/pages/Ada.md": [
        "alias:: Countess",
        "",
        `- DONE wrote the "notes"`,
        "  id:: 61506710-484c-46d5-9983-3d1651ec02c8",
        "  collapsed:: true",
        "\t- child",
        "",
      ].join("\n"),
      "demo_markdown_1761120000/pages/Babbage.md": [
        `- met wrote the "notes"`,
        `\t- DONE wrote the "notes"`,
        "\t  collapsed:: true",
        "\t\t- child",
        "",
      ].join("\n"),
    })
  })

  it("keeps property names in any script, and drops ones EDN can't read", () => {
    const named = pagesOf({ Notes: `- read\n  作者:: Ada\n  état:: done\n  a(b):: no` })
    expect(
      JSON.parse(strFromU8(exportGraph(named, "json", options).bytes)).blocks[0].children[0]
        .properties,
    ).toEqual({
      作者: "Ada",
      état: "done",
    })
  })

  it("zips one OPML file per page", () => {
    const files = unzipSync(exportGraph(pages, "opml", options).bytes)
    expect(Object.keys(files)).toEqual([
      "demo_opml_1761120000/pages/Ada.opml",
      "demo_opml_1761120000/pages/Babbage.opml",
    ])
    expect(strFromU8(files["demo_opml_1761120000/pages/Ada.opml"] ?? new Uint8Array())).toContain(
      `<outline text="DONE wrote the &quot;notes&quot;">`,
    )
  })
})
