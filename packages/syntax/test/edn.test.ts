import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { printFipp, readEdn } from "../src/index.ts"

const roundTrip = (text: string) => printFipp(Result.getOrThrow(readEdn(text)))

const logseqSample = `{:highlights [{:id #uuid "65a1b2c3-0000-4000-8000-000000000001",
               :page 1,
               :position {:bounding {:x1 98.5,
                                     :y1 155.6875,
                                     :x2 506.4453125,
                                     :y2 176.6875,
                                     :width 595.2760000000001,
                                     :height 841.89},
                          :rects ({:x1 98.5,
                                   :y1 155.6875,
                                   :x2 506.4453125,
                                   :y2 165.6875,
                                   :width 595.2760000000001,
                                   :height 841.89}
                                  {:x1 98.5,
                                   :y1 166.6875,
                                   :x2 300.25,
                                   :y2 176.6875,
                                   :width 595.2760000000001,
                                   :height 841.89}),
                          :page 1},
               :content {:text "Hello world, this is highlighted text"},
               :properties {:color "yellow"}}
              {:id #uuid "65a1b2c3-0000-4000-8000-000000000002",
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

describe("printFipp writes what fipp 0.6.26 prints in Logseq", () => {
  it("lays out a highlights file exactly as the real fipp did", () => {
    expect(roundTrip(logseqSample)).toBe(logseqSample)
  })

  it.each([
    "{:highlights [], :extra {:page 1}}\n",
    "{:highlights [], :extra nil}\n",
    '{:a [1 2 3],\n :b {:c "dddddddddddddddddddddddddddddddddddddddddddddddddddddddd",\n     :e #{1}}}\n',
    '{:highlights [{:id #uuid "0190a1b2-0000-7000-8000-000000000001",\n               :page 1,\n               :position {:bounding {:x1 1,\n                                     :y1 2,\n                                     :x2 3,\n                                     :y2 4,\n                                     :width 5,\n                                     :height 6},\n                          :rects (),\n                          :page 1},\n               :content {:text "x", :image 1},\n               :properties {:color "red"}}],\n :extra nil}\n',
    '{:highlights [{:id #uuid "0190a1b2-0000-7000-8000-000000000001",\n               :page 12,\n               :position {:bounding {:x1 1,\n                                     :y1 2.5,\n                                     :x2 3,\n                                     :y2 4,\n                                     :width 600,\n                                     :height 800},\n                          :rects ({:x1 1,\n                                   :y1 2.5,\n                                   :x2 3,\n                                   :y2 4,\n                                   :width 600,\n                                   :height 800}),\n                          :page 12},\n               :content {:text "A \\"quoted\\" line\\nwith a break, a tab\\tand ünïcödé — plus a very long tail that keeps going past seventy columns"},\n               :properties {:color "purple"}}],\n :extra {:page 12}}\n',
  ])("matches fipp's own output %#", (expected) => {
    expect(roundTrip(expected)).toBe(expected)
  })

  it("reads strings back with their escapes", () => {
    expect(readEdn('{:text "a \\"b\\"\\nc"}')).toEqual(
      Result.succeed({ _tag: "Map", entries: [[{ _tag: "Keyword", name: "text" }, 'a "b"\nc']] }),
    )
  })
})
