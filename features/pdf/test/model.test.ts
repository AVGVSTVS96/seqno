import { readFileSync } from "node:fs"
import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { printHighlights, readHighlights } from "../src/highlights.ts"
import {
  annotationProps,
  displayName,
  fixSelectionText,
  hlsPageProps,
  inflateAsset,
  optimizeClientRects,
  sanitizeFilename,
  scaledToViewport,
  zoomIn,
  zoomOut,
} from "../src/model.ts"

describe("inflateAsset, as Logseq's inflate-asset", () => {
  it("keys an uploaded PDF by its stem", () => {
    expect(inflateAsset("../assets/My_Paper_1700000000000_0.pdf")).toEqual({
      key: "My_Paper_1700000000000_0",
      identity: "1700000000000_0",
      filename: "My_Paper_1700000000000_0.pdf",
      hlsFile: "assets/My_Paper_1700000000000_0.edn",
      originalPath: "../assets/My_Paper_1700000000000_0.pdf",
    })
  })

  it("keeps the .edn at the top of assets/ for a PDF in a subfolder", () => {
    expect(inflateAsset("../assets/books/Deep Work.pdf")?.hlsFile).toBe("assets/Deep Work.edn")
  })

  it("adds the ClojureScript hash of a web link's URL", () => {
    expect(inflateAsset("https://example.com/papers/A Paper.pdf")?.key).toBe("A Paper__-2013943856")
  })

  it("strips what sanitize-filename strips", () => {
    expect(sanitizeFilename('a:b*c?"d|e<f>. ')).toBe("abcdef")
    expect(sanitizeFilename("con.txt")).toBe("")
  })
})

describe("the hls page", () => {
  it("shows Logseq's display name", () => {
    expect(displayName("hls__My_Paper_1700000000000_0")).toBe("My Paper")
    expect(displayName("hls__A Paper__-2013943856")).toBe("A Paper")
    expect(displayName("Plain page")).toBe("Plain page")
  })

  it("links the file by its base name", () => {
    const asset = inflateAsset("../assets/My_Paper_1700000000000_0.pdf")
    expect(asset === null ? null : hlsPageProps(asset, false)).toEqual({
      file: "[My_Paper_1700000000000_0.pdf](../assets/My_Paper_1700000000000_0.pdf)",
      "file-path": "../assets/My_Paper_1700000000000_0.pdf",
    })
  })
})

describe("annotation blocks", () => {
  const position = {
    bounding: { x1: 60, y1: 80, x2: 300, y2: 200, width: 406, height: 525.4 },
    rects: [],
    page: 2,
  }

  it("write a text highlight's properties in Logseq's order", () => {
    expect(
      Object.entries(
        annotationProps({
          id: "6ae9edd1-3d4a-41b9-b238-ec88d1525352",
          page: 1,
          position: { ...position, page: 1 },
          content: { text: "The quick brown fox jumps" },
          properties: { color: "green" },
        }),
      ),
    ).toEqual([
      ["ls-type", "annotation"],
      ["hl-page", "1"],
      ["hl-color", "green"],
      ["id", "6ae9edd1-3d4a-41b9-b238-ec88d1525352"],
    ])
  })

  it("add an area's type and picture stamp after its id", () => {
    expect(
      Object.entries(
        annotationProps({
          id: "6ae9edd5-8708-4843-820f-da66eb9673cd",
          page: 2,
          position,
          content: { text: "[:span]", image: 1_793_715_669_070 },
          properties: { color: "purple" },
        }),
      ),
    ).toEqual([
      ["ls-type", "annotation"],
      ["hl-page", "2"],
      ["hl-color", "purple"],
      ["id", "6ae9edd5-8708-4843-820f-da66eb9673cd"],
      ["hl-type", "area"],
      ["hl-stamp", "1793715669070"],
    ])
  })
})

describe("selection text and geometry", () => {
  it.each([
    ["this is a\ntest paragraph", "this is a test paragraph"],
    ["he is 1\n8 years old", "he is 18 years old"],
    ["这是一个\n\n段落", "这是一个段落"],
    ["this is a te-\nst paragraph", "this is a test paragraph"],
  ])("joins %j", (text, joined) => {
    expect(fixSelectionText(text)).toBe(joined)
  })

  it("redraws a highlight at another zoom", () => {
    expect(
      scaledToViewport(
        { x1: 100, y1: 50, x2: 300, y2: 70, width: 600, height: 800 },
        { width: 1200, height: 1600 },
      ),
    ).toEqual({ left: 200, top: 100, width: 400, height: 40 })
  })

  it("merges the rects of one line", () => {
    expect(
      optimizeClientRects([
        { left: 60, top: 10, width: 40, height: 12 },
        { left: 10, top: 10, width: 50, height: 12 },
        { left: 10, top: 30, width: 80, height: 12 },
      ]),
    ).toEqual([
      { left: 10, top: 10, width: 90, height: 12 },
      { left: 10, top: 30, width: 80, height: 12 },
    ])
  })

  it("zooms in Logseq's steps", () => {
    expect([zoomIn(1), zoomIn(4.9), zoomOut(1), zoomOut(0.26)]).toEqual([1.1, 5, 0.9, 0.25])
  })
})

describe("the highlights file", () => {
  const logseq = `{:highlights [{:id #uuid "65a1b2c3-0000-4000-8000-000000000002",
               :page 2,
               :position {:bounding {:x1 120,
                                     :y1 200.5,
                                     :x2 400,
                                     :y2 380,
                                     :width 595.2760000000001,
                                     :height 841.89},
                          :rects (),
                          :page 2},
               :content {:text "[:span]", :image 1700000000000},
               :properties {:color "green"}}],
 :extra {:page 2}}
`

  it("reads Logseq's file and writes it back byte for byte", () => {
    const read = Result.getOrThrow(readHighlights(logseq))
    expect(read.page).toBe(2)
    expect(read.highlights[0]?.content).toEqual({ text: "[:span]", image: 1_700_000_000_000 })
    expect(printHighlights(read)).toBe(logseq)
  })

  it("rewrites a highlights file Logseq 0.10.9 made in its viewer byte for byte", () => {
    const made = readFileSync(
      new URL(
        "../../../fixtures/graphs/pdf-highlights/assets/Paper_1700000000000_0.edn",
        import.meta.url,
      ),
      "utf-8",
    )

    const read = Result.getOrThrow(readHighlights(made))
    expect(read.highlights.map((highlight) => highlight.content.text)).toEqual([
      "The quick brown fox jumps",
      "[:span]",
    ])
    expect(printHighlights(read)).toBe(made)
  })

  it("reads the file Logseq makes for a new PDF", () => {
    expect(readHighlights("{:highlights []}")).toEqual(
      Result.succeed({ highlights: [], page: null }),
    )
    expect(printHighlights({ highlights: [], page: 1 })).toBe(
      "{:highlights [], :extra {:page 1}}\n",
    )
  })
})
