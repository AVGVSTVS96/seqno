import { strFromU8, unzipSync } from "fflate"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  allPagesPublic,
  indexHtml,
  namesLinked,
  publishedReferences,
  Published,
  publishedDataId,
  publicPages,
  publicSite,
  queriesIn,
  usedAssets,
  zipSite,
} from "../src/index.ts"
import { pagesOf } from "./graph.ts"

const graph = pagesOf({
  Garden:
    "public:: true\nalias:: Allotment\n\n- Beds run [[north]] ![sketch](../assets/sketch.svg)",
  Allotment: "- the plot",
  Plot: "alias:: Garden\n\n- 14B",
  Diary: "- private thoughts ![x](../assets/secret.png)",
  Hidden: "public:: false\n\n- not here",
  Notes:
    "public:: TRUE\n\n- {{query (task TODO)}}\n- ![code](../assets/run.js) {{query [[north]] }}",
})

const titles = (pages: ReadonlyArray<{ readonly page: { readonly title: string } }>) =>
  pages.map(({ page }) => page.title)

describe("publicPages", () => {
  it("keeps public:: true pages and their aliases both ways, as Logseq does", () => {
    expect(titles(publicPages(graph, false))).toEqual(["Garden", "Allotment", "Plot", "Notes"])
  })

  it("keeps every page but public:: false when all pages are public", () => {
    expect(titles(publicPages(graph, true))).toEqual([
      "Garden",
      "Allotment",
      "Plot",
      "Diary",
      "Notes",
    ])
  })
})

describe("allPagesPublic", () => {
  it("reads :publishing/all-pages-public? and the old key from config.edn", () => {
    expect(allPagesPublic("{:publishing/all-pages-public? true}")).toBe(true)
    expect(allPagesPublic("{:all-pages-public? true\n}")).toBe(true)
    expect(allPagesPublic("{:publishing/all-pages-public? false}")).toBe(false)
    expect(allPagesPublic(";; :publishing/all-pages-public? true\n{}")).toBe(false)
    expect(allPagesPublic("{}")).toBe(false)
  })
})

describe("usedAssets and queriesIn", () => {
  it("finds the assets Logseq copies, skipping .js, and the queries to answer ahead", () => {
    const published = publicPages(graph, false)
    expect(usedAssets(published)).toEqual(["assets/sketch.svg"])
    expect(queriesIn(published)).toEqual(["(task TODO)", "[[north]]"])
  })
})

describe("namesLinked and publishedReferences", () => {
  it("lists the unpublished names published pages link to, and keeps only published blocks", () => {
    const published = publicPages(graph, false)
    expect(namesLinked(published)).toEqual([{ name: "north", title: "north" }])
    const garden = published[0]?.blocks[0]
    const diary = graph[3]?.blocks[0]
    if (garden === undefined || diary === undefined) throw new Error("missing fixture blocks")
    expect(
      publishedReferences(published, [
        { blockId: garden.id, pageId: garden.pageId },
        { blockId: diary.id, pageId: diary.pageId },
      ]),
    ).toEqual([{ blockId: garden.id, pageId: garden.pageId }])
  })
})

describe("publicSite", () => {
  const data: Published = {
    graph: "My <Graph>",
    theme: "light",
    referenced: [],
    references: {},
    pages: publicPages(graph, false).map((entry) => ({ ...entry, created: 1, updated: 2 })),
    queries: {},
    listKeys: ["tags", "alias"],
  }

  it("embeds the pages as JSON that survives a </script> in a block", () => {
    const withScript: Published = {
      ...data,
      pages: data.pages.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              blocks: entry.blocks.map((block) => ({ ...block, text: "</script><b>" })),
            }
          : entry,
      ),
    }
    const html = indexHtml(withScript)
    expect(html).toContain("<title>My &lt;Graph&gt;</title>")
    const start = html.indexOf(`<script id="${publishedDataId}" type="application/json">`)
    const json = html.slice(html.indexOf(">", start) + 1, html.indexOf("</script>", start))
    expect(json).not.toContain("</script>")
    const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(Published))(json)
    expect(decoded.pages[0]?.blocks[0]?.text).toBe("</script><b>")
    expect(decoded.graph).toBe("My <Graph>")
  })

  it("lays out Logseq's folder: index.html, 404.html, static/ and assets/", () => {
    const files = publicSite(
      data,
      [
        ["static/js/seqno.js", new Uint8Array([2])],
        ["static/img/logo.svg", new Uint8Array([4])],
      ],
      { customCss: "a{}", exportCss: "", customJs: "" },
      [["assets/sketch.svg", new Uint8Array([1])]],
    )
    expect(files.map(([path]) => path)).toEqual([
      "index.html",
      "404.html",
      "static/js/seqno.js",
      "static/img/logo.svg",
      "static/css/custom.css",
      "static/css/export.css",
      "static/js/custom.js",
      "assets/sketch.svg",
    ])
    const zipped = unzipSync(zipSite("site", files, 1_793_700_000))
    expect(Object.keys(zipped)).toHaveLength(8)
    expect(strFromU8(zipped["site/static/css/custom.css"] ?? new Uint8Array())).toBe("a{}")
  })
})
