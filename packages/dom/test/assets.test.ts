import { describe, expect, it } from "vitest"
import { logseq } from "../src/index.ts"

describe("asset names", () => {
  it("names PDF and file links, videos and the image frame as Logseq renders them", () => {
    expect(logseq("seqno-asset", { kind: "pdf", url: "../assets/a.pdf" })).toEqual({
      className: "seqno-asset asset-ref is-pdf",
      "data-href": "../assets/a.pdf",
    })
    expect(logseq("seqno-asset", { kind: "doc", url: "../assets/b.docx" }).className).toBe(
      "seqno-asset asset-ref is-doc",
    )
    expect(logseq("seqno-asset-video", { ext: "mp4" })).toEqual({
      className: "seqno-asset-video asset-ref-wrap",
      "data-ext": "mp4",
    })
    expect(
      [
        logseq("seqno-image-frame"),
        logseq("seqno-image"),
        logseq("seqno-image-overlay"),
        logseq("seqno-image-actions"),
        logseq("seqno-image-action"),
      ].map((made) => made.className),
    ).toEqual([
      "seqno-image-frame resize image-resize asset-container",
      "seqno-image rounded-sm relative",
      "seqno-image-overlay asset-overlay",
      "seqno-image-actions asset-action-bar",
      "seqno-image-action asset-action-btn",
    ])
  })
})
