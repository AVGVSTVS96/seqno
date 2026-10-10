import { describe, expect, it } from "@effect/vitest"
import { placeTip, type Box, type Surroundings } from "../src/ui/hints/place.ts"

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

const page = (overrides: Partial<Surroundings>): Surroundings => ({
  targets: [box(300, 200, 80, 20)],
  sizes: [{ width: 200, height: 40 }],
  viewport: box(0, 0, 1200, 800),
  content: [],
  pointer: null,
  current: null,
  ...overrides,
})

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

describe("placeTip", () => {
  it("sits beside a target with nothing around it, its caret level with the target's center", () => {
    const placement = placeTip(page({}))
    expect(placement?.side).toBe("right")
    expect(placement?.box).toEqual(box(391, 190, 200, 40))
    expect(placement?.caret).toBe(20)
    expect(placement?.covered).toBe(0)
  })

  it("clears the rest of the target's line instead of covering the next line", () => {
    const startOfLine = box(20, 200, 276, 20)
    const restOfLine = box(384, 200, 220, 20)
    const nextLine = box(20, 228, 480, 20)
    const lineAbove = box(20, 172, 430, 20)
    const placement = placeTip(page({ content: [startOfLine, restOfLine, nextLine, lineAbove] }))
    expect(placement?.side).toBe("right")
    expect(placement?.box.left).toBeGreaterThanOrEqual(restOfLine.right)
    expect(placement?.covered).toBe(0)
  })

  it("moves out from under a resting pointer", () => {
    const placement = placeTip(page({ pointer: { x: 480, y: 210 } }))
    expect(placement?.side).toBe("bottom")
    expect(placement?.box).toEqual(box(240, 231, 200, 40))
  })

  it("keeps the caret off the rounded corners when the target hugs the viewport edge", () => {
    const placement = placeTip(page({ targets: [box(8, 8, 32, 32)] }))
    expect(placement?.side).toBe("right")
    expect(placement?.box.top).toBe(8)
    expect(placement?.caret).toBe(16)
  })

  it("covers as little as it can, and says so, when every spot near the target has text", () => {
    const placement = placeTip(page({ content: [box(0, 150, 1200, 140)] }))
    expect(placement?.side).toBe("top")
    expect(placement?.covered).toBe(200 * 39)
  })

  it("points at whichever target has room around it", () => {
    const crowded = box(300, 200, 80, 20)
    const open = box(300, 600, 80, 20)
    const content = [box(0, 140, 1200, 140)]
    const placement = placeTip(page({ targets: [crowded, open], content }))
    expect(placement?.target).toBe(1)
    expect(overlaps(placement?.box ?? box(0, 0, 0, 0), content[0] ?? box(0, 0, 0, 0))).toBe(false)
  })
})
