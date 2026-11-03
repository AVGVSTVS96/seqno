import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { readPropertyConfig } from "@seqno/syntax"
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

const zippedWithBoard = (format: "markdown" | "opml") =>
  Object.keys(
    unzipSync(
      exportGraph(pages, format, {
        ...options,
        path: (page) => (page.title === "Ada" ? "whiteboards/Ada.edn" : `pages/${page.title}.md`),
      }).bytes,
    ),
  )

describe("graph export", () => {
  it("writes EDN in Logseq's shape, which its EDN import reads", () => {
    expect(exportGraph(pages, "edn", options).name).toBe("demo_1761120000.edn")
    expect(text("edn")).toBe(
      [
        `{:version 1,`,
        ` :blocks`,
        ` ({:block/id #uuid "${pageId(1)}",`,
        `   :block/page-name "Ada",`,
        `   :block/properties {:alias #{"Countess"}},`,
        `   :block/children`,
        `   ({:block/id #uuid "e1ec9c62-9b7c-47ca-8467-4745f4029093",`,
        `     :block/properties {:alias #{"Countess"}},`,
        `     :block/format :markdown,`,
        `     :block/children [],`,
        `     :block/content ""}`,
        `    {:block/id #uuid "61506710-484c-46d5-9983-3d1651ec02c8",`,
        `     :block/properties {},`,
        `     :block/format :markdown,`,
        `     :block/children`,
        `     [{:block/id #uuid "${block(2)}",`,
        `       :block/properties nil,`,
        `       :block/format :markdown,`,
        `       :block/children [],`,
        `       :block/content "child"}],`,
        `     :block/content "DONE wrote the \\"notes\\"\\ncollapsed:: true"})}`,
        `  {:block/id #uuid "${pageId(2)}",`,
        `   :block/page-name "Babbage",`,
        `   :block/properties nil,`,
        `   :block/children`,
        `   ({:block/id #uuid "${block(3)}",`,
        `     :block/properties nil,`,
        `     :block/format :markdown,`,
        `     :block/children`,
        `     [{:block/id #uuid "${block(4)}",`,
        `       :block/properties nil,`,
        `       :block/format :markdown,`,
        `       :block/children [],`,
        `       :block/content "{{embed [[Ada]]}}"}],`,
        `     :block/content "met ((61506710-484c-46d5-9983-3d1651ec02c8))"})})}`,
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
          properties: { alias: ["Countess"] },
          children: [
            {
              id: "e1ec9c62-9b7c-47ca-8467-4745f4029093",
              properties: { alias: ["Countess"] },
              format: "markdown",
              children: [],
              content: "",
            },
            {
              id: "61506710-484c-46d5-9983-3d1651ec02c8",
              properties: {},
              format: "markdown",
              children: [
                {
                  id: block(2),
                  properties: null,
                  format: "markdown",
                  children: [],
                  content: "child",
                },
              ],
              content: 'DONE wrote the "notes"\ncollapsed:: true',
            },
          ],
        },
        {
          id: pageId(2),
          "page-name": "Babbage",
          properties: null,
          children: [
            {
              id: block(3),
              properties: null,
              format: "markdown",
              children: [
                {
                  id: block(4),
                  properties: null,
                  format: "markdown",
                  children: [],
                  content: "{{embed [[Ada]]}}",
                },
              ],
              content: "met ((61506710-484c-46d5-9983-3d1651ec02c8))",
            },
          ],
        },
      ],
    })
  })

  it("types property values as Logseq parses them", () => {
    const typed = pagesOf({
      Kinds: [
        "- values",
        "  done:: true",
        "  shown:: false",
        "  count:: 007",
        "  ratio:: 2.5",
        "  tags:: foo, [[bar baz]], #qux",
        "  note:: for the [[Garden Plan]] bed",
        "  type2:: book, film",
        "  title:: My [[Title]]",
        '  quoted:: "x [[y]]"',
        "- ## A heading",
        "- ####### Seven hashes",
      ].join("\n"),
    })
    const blocks = JSON.parse(strFromU8(exportGraph(typed, "json", options).bytes)).blocks[0]
      .children
    expect(blocks.map((entry: { properties: unknown }) => entry.properties)).toEqual([
      {
        done: true,
        shown: false,
        count: 7,
        ratio: "2.5",
        tags: ["bar baz", "qux", "foo"],
        note: ["Garden Plan"],
        type2: "book, film",
        title: "My [[Title]]",
        quoted: '"x [[y]]"',
      },
      { heading: 2 },
      { heading: 7 },
    ])
  })

  it("types properties with config.edn's comma-separated and ignored keys as Logseq does", () => {
    const books = pagesOf({
      Books: [
        "genre:: poetry, prose",
        "",
        "- Dune",
        "  genre:: fiction, sci-fi",
        "  author:: [[Frank Herbert]]",
        "  website:: [[Wiki]]",
        "  other:: a, b",
        "  rating:: 5",
        "- Plain author",
        "  author:: Ursula, Le Guin",
        "  genre:: [[Space Opera]], hard sf",
      ].join("\n"),
    })
    const properties = readPropertyConfig(
      '{:property/separated-by-commas #{:genre}\n :ignored-page-references-keywords #{:author "website"}}',
    )
    const page = JSON.parse(strFromU8(exportGraph(books, "json", { ...options, properties }).bytes))
      .blocks[0]
    expect([
      page.properties,
      ...page.children.map((entry: { properties: unknown }) => entry.properties),
    ]).toEqual([
      { genre: ["poetry", "prose"] },
      { genre: ["poetry", "prose"] },
      {
        genre: ["fiction", "sci-fi"],
        author: ["Frank Herbert"],
        website: "[[Wiki]]",
        other: "a, b",
        rating: 5,
      },
      { author: "Ursula, Le Guin", genre: ["Space Opera", "hard sf"] },
    ])
  })

  it("writes Roam JSON with uids on referenced blocks and linked pages", () => {
    expect(JSON.parse(text("roam-json"))).toEqual([
      {
        title: "Ada",
        uid: "hCjtQr4uN",
        children: [
          { string: "alias:: Countess", children: [] },
          {
            string: '{{[[DONE]]}} wrote the "notes"\nid:: Z6Sc4cYrc\ncollapsed:: true',
            uid: "Z6Sc4cYrc",
            children: [{ string: "child", children: [] }],
          },
        ],
      },
      {
        title: "Babbage",
        children: [
          {
            string: "met ((Z6Sc4cYrc))",
            children: [{ string: "{{embed: [[Ada]]}}", children: [] }],
          },
        ],
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
        "  alias:: Countess",
        "  ",
        `- DONE wrote the "notes"`,
        "  id:: 61506710-484c-46d5-9983-3d1651ec02c8",
        "  collapsed:: true",
        "\t- child",
        "",
      ].join("\n"),
      "demo_markdown_1761120000/pages/Babbage.md": [
        `- met wrote the "notes"`,
        "  alias:: Countess",
        "  ",
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

  it("leaves pages kept in other files, like whiteboards, out of the Markdown and OPML zips", () => {
    expect(zippedWithBoard("markdown")).toEqual(["demo_markdown_1761120000/pages/Babbage.md"])
    expect(zippedWithBoard("opml")).toEqual(["demo_opml_1761120000/pages/Babbage.opml"])
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
