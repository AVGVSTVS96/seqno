import { describe, expect, it } from "vitest"
import {
  assetFileName,
  assetKind,
  assetLink,
  assetPathOf,
  insertAsset,
  parseInline,
} from "../src/index.ts"

const now = 1730611200000

describe("asset file names, as Logseq writes them", () => {
  it.each([
    ["My Photo.PNG", "My_Photo_1730611200000_0.PNG"],
    ["a__b c.pdf", "a_b_c_1730611200000_0.pdf"],
    ["photo.v2.png", "photo.v2_1730611200000_0.png"],
    ["data.tar.gz", "data_1730611200000_0.tar.gz"],
    ["Makefile", "Makefile_1730611200000_0"],
    ["50% off.jpg", "50_off_1730611200000_0.jpg"],
  ])("%s becomes %s", (original, written) => {
    expect(assetFileName(original, now, 0)).toBe(written)
  })

  it("numbers each file of a drop", () => {
    expect(assetFileName("image.png", now, 2)).toBe("image_1730611200000_2.png")
  })
})

describe("asset links, as Logseq inserts them", () => {
  it.each([
    [
      "My Photo.PNG",
      "assets/My_Photo_1730611200000_0.PNG",
      "![My Photo.PNG](../assets/My_Photo_1730611200000_0.PNG)",
    ],
    ["a.pdf", "assets/a_1730611200000_0.pdf", "![a.pdf](../assets/a_1730611200000_0.pdf)"],
    ["song.mp3", "assets/song_1_0.mp3", "![song.mp3](../assets/song_1_0.mp3)"],
    ["clip.mov", "assets/clip_1_0.mov", "![clip.mov](../assets/clip_1_0.mov)"],
    ["song.ogg", "assets/song_1_0.ogg", "[song.ogg](../assets/song_1_0.ogg)"],
    ["report.docx", "assets/report_1_0.docx", "[report.docx](../assets/report_1_0.docx)"],
    ["a.tar.gz", "assets/a_1_0.tar.gz", "[a.tar.gz](../assets/a_1_0.tar.gz)"],
  ])("%s links as %s", (label, path, link) => {
    expect(assetLink(label, path)).toBe(link)
  })

  it("uses Org's link syntax on Org pages", () => {
    expect(assetLink("a.png", "assets/a_1_0.png", "org")).toBe("[[../assets/a_1_0.png]]")
    expect(assetLink("a.pdf", "assets/a_1_0.pdf", "org")).toBe("[[../assets/a_1_0.pdf][a.pdf]]")
    expect(
      parseInline("[[../assets/a.png]] [[../assets/b.pdf][b.pdf]]", 0, "org").flatMap((node) =>
        node._tag === "Image" ? [[node.url, node.alt]] : [],
      ),
    ).toEqual([
      ["../assets/a.png", ""],
      ["../assets/b.pdf", "b.pdf"],
    ])
  })

  it("goes at the caret with one space on each side, and drops blank text after it", () => {
    expect(insertAsset("Hello ", 6, 6, "![a](../assets/a.png)")).toEqual({
      text: "Hello ![a](../assets/a.png)",
      caret: 27,
    })
    expect(insertAsset("foobar", 3, 3, "[b](../assets/b.zip)")).toEqual({
      text: "foo [b](../assets/b.zip) bar",
      caret: 24,
    })
    expect(insertAsset("", 0, 0, "[b](../assets/b.zip)")).toEqual({
      text: "[b](../assets/b.zip)",
      caret: 20,
    })
    expect(insertAsset("first\nrest", 5, 5, "[b](x)")).toEqual({
      text: "first [b](x) \nrest",
      caret: 12,
    })
  })
})

describe("asset kinds and paths", () => {
  it("renders each kind the way Logseq picks it", () => {
    expect(
      ["a.png", "b.PDF", "c.mp3", "d.ogg", "e.webm", "f.avi", "g.json", "h.docx"].map(assetKind),
    ).toEqual(["Image", "Pdf", "Audio", "Audio", "Video", "File", "Text", "File"])
  })

  it("reads every relative form of a link as one path inside assets/", () => {
    expect(
      [
        "../assets/x.png",
        "assets/x.png",
        "../../assets/x.png",
        "/assets/x.png",
        "./assets/a%20b.png",
      ].map(assetPathOf),
    ).toEqual(["assets/x.png", "assets/x.png", "assets/x.png", "assets/x.png", "assets/a b.png"])
    expect(
      ["../pages/x.md", "assets/../logseq/config.edn", "https://x.dev/a.png"].map(assetPathOf),
    ).toEqual([null, null, null])
  })
})
