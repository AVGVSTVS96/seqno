import { describe, expect, it } from "vitest"
import { logseq } from "../src/index.ts"

describe("PDF viewer names", () => {
  it("names the viewer as the plugins that look it up expect", () => {
    expect(logseq("seqno-pdf", { identity: "Paper_1_0", theme: "dark" })).toEqual({
      className: "seqno-pdf extensions__pdf-container",
      id: "pdf-layout-container_Paper_1_0",
      "data-theme": "dark",
    })
    expect(logseq("seqno-pdf-viewer", true).className).toBe(
      "seqno-pdf-viewer extensions__pdf-viewer overflow-x-auto is-area-dashed",
    )
    expect(logseq("seqno-pdf-scroller").className).toBe(
      "seqno-pdf-scroller extensions__pdf-viewer-cnt visible-scrollbar",
    )
    expect(logseq("seqno-pdf-buttons").className).toBe("seqno-pdf-buttons r flex buttons")
  })

  it("names highlights and their menu with Logseq's ids, colors and states", () => {
    expect(logseq("seqno-pdf-area-region", "a1", "blue")).toEqual({
      className: "seqno-pdf-area-region extensions__pdf-hls-area-region",
      id: "hl_a1",
      "data-color": "blue",
    })
    expect(logseq("seqno-pdf-text-region-item", undefined)).toEqual({
      className: "seqno-pdf-text-region-item hls-text-region-item",
    })
    expect(logseq("seqno-pdf-button", true).className).toBe("seqno-pdf-button button is-active")
    expect(logseq("seqno-pdf-outline-item", { parent: true, expanded: false }).className).toBe(
      "seqno-pdf-outline-item extensions__pdf-outline-item has-children",
    )
    expect(logseq("seqno-pdf-item").className).toBe("seqno-pdf-item item")
  })

  it("names annotation blocks and refs as block.cljs renders them", () => {
    expect(logseq("seqno-annotation", { color: "green" })).toEqual({
      className: "seqno-annotation",
      "data-type": "annotation",
      "data-hl-color": "green",
    })
    expect(logseq("seqno-annotation-ref", { area: true })).toEqual({
      className: "seqno-annotation-ref block-ref-wrap inline",
      "data-type": "annotation",
      "data-hl-type": "area",
    })
    expect(logseq("seqno-annotation-prefix").className).toBe("seqno-annotation-prefix prefix-link")
    expect(logseq("seqno-hl-colored").className).toBe("seqno-hl-colored ls-hl-colored")
  })
})
