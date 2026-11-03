import { assert, describe, it } from "@effect/vitest"
import { cameraBetween } from "../src/camera.ts"

const viewport = { width: 1000, height: 800 }
const from = { x: 0, y: 0, zoom: 1 }
const to = { x: -200, y: 100, zoom: 2 }

describe("camera glide", () => {
  it("eases the view's corner in a line and its width, so zoom moves harmonically, as Logseq's camera does", () => {
    assert.deepStrictEqual(cameraBetween(from, to, viewport, 0), from)
    const half = cameraBetween(from, to, viewport, 0.5)
    assert.closeTo(half.x, -100, 1e-9)
    assert.closeTo(half.y, 50, 1e-9)
    assert.closeTo(half.zoom, 1000 / 750, 1e-9)
    const quarter = cameraBetween(from, to, viewport, 0.25)
    assert.closeTo(quarter.x, -200 * (-(Math.cos(Math.PI / 4) - 1) / 2), 1e-9)
    assert.deepStrictEqual(cameraBetween(from, to, viewport, 1), to)
  })
})
