export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export type Side = "top" | "right" | "bottom" | "left"

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Placement {
  readonly target: number
  readonly size: number
  readonly side: Side
  readonly box: Box
  readonly caret: number
  readonly covered: number
}

export interface Surroundings {
  readonly targets: ReadonlyArray<Box>
  readonly sizes: ReadonlyArray<Size>
  readonly viewport: Box
  readonly content: ReadonlyArray<Box>
  readonly pointer: Point | null
  readonly current: Placement | null
}

export const caretDepth = 7

const gap = caretDepth + 4
const caretInset = 16
const edge = 8
const breathingRoom = 6
const sides: ReadonlyArray<Side> = ["right", "bottom", "left", "top"]
const lineReach = 320
const lineJoin = 24
const step = { along: 4, away: 8 }
const pointerRoom = 12
const cost = {
  side: 150,
  away: 4,
  offCenter: 0.5,
  narrower: 2,
  laterTarget: 60,
  keepSide: 400,
  pointer: 20_000,
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

const grow = (box: Box, by: number): Box => ({
  left: box.left - by,
  top: box.top - by,
  right: box.right + by,
  bottom: box.bottom + by,
})

const within = (box: Box, bounds: Box) =>
  box.left >= bounds.left &&
  box.top >= bounds.top &&
  box.right <= bounds.right &&
  box.bottom <= bounds.bottom

const range = (from: number, to: number, by: number) =>
  Array.from(
    { length: Math.max(0, Math.floor((to - from) / by)) + 1 },
    (_, index) => from + index * by,
  )

interface Spot {
  readonly side: Side
  readonly box: Box
  readonly caret: number
  readonly away: number
}

const restOfLine = (target: Box, content: ReadonlyArray<Box>, side: "left" | "right") => {
  const line = content.filter((box) => box.bottom > target.top + 2 && box.top < target.bottom - 2)
  const start = side === "right" ? target.right : -target.left
  let reached = start
  for (let grown = true; grown;) {
    grown = false
    for (const box of line) {
      const near = side === "right" ? box.left : -box.right
      const far = side === "right" ? box.right : -box.left
      if (near >= start - 1 && near <= reached + lineJoin && far > reached) {
        reached = far
        grown = true
      }
    }
  }
  return Math.min(lineReach, reached - start + lineJoin)
}

const spotsBeside = (target: Box, size: Size, side: Side, reach: number): ReadonlyArray<Spot> => {
  const horizontal = side === "left" || side === "right"
  const point = horizontal ? (target.top + target.bottom) / 2 : (target.left + target.right) / 2
  const length = horizontal ? size.height : size.width
  const first = point - length + caretInset
  const last = point - caretInset
  if (last < first) return []
  const starts = [...range(first, last, step.along), point - length / 2]
  return [...range(0, reach, step.away), reach].flatMap((away) =>
    starts.map((start) => {
      const near = {
        right: target.right + gap + away,
        left: target.left - gap - away - size.width,
        bottom: target.bottom + gap + away,
        top: target.top - gap - away - size.height,
      }[side]
      const box = horizontal
        ? { left: near, top: start, right: near + size.width, bottom: start + size.height }
        : { left: start, top: near, right: start + size.width, bottom: near + size.height }
      return { side, box, caret: point - start, away }
    }),
  )
}

const coveredBy = (box: Box, content: ReadonlyArray<Box>) =>
  content.reduce((sum, line) => sum + overlap(box, line), 0)

const caretBox = ({ side, box, caret }: Spot): Box => {
  const half = caretDepth
  return {
    right: {
      left: box.left - caretDepth,
      top: box.top + caret - half,
      right: box.left,
      bottom: box.top + caret + half,
    },
    left: {
      left: box.right,
      top: box.top + caret - half,
      right: box.right + caretDepth,
      bottom: box.top + caret + half,
    },
    bottom: {
      left: box.left + caret - half,
      top: box.top - caretDepth,
      right: box.left + caret + half,
      bottom: box.top,
    },
    top: {
      left: box.left + caret - half,
      top: box.bottom,
      right: box.left + caret + half,
      bottom: box.bottom + caretDepth,
    },
  }[side]
}

const under = (box: Box, pointer: Point | null) =>
  pointer !== null &&
  pointer.x >= box.left - pointerRoom &&
  pointer.x <= box.right + pointerRoom &&
  pointer.y >= box.top - pointerRoom &&
  pointer.y <= box.bottom + pointerRoom

export const placeTip = ({
  targets,
  sizes,
  viewport,
  content,
  pointer,
  current,
}: Surroundings): Placement | null => {
  const bounds = grow(viewport, -edge)
  const widest = Math.max(...sizes.map((size) => size.width))
  const tallest = Math.max(...sizes.map((size) => size.height))
  let best: Placement | null = null
  let bestScore = Infinity
  for (const [index, target] of targets.entries()) {
    const area = grow(target, Math.max(widest, tallest) + lineReach)
    const nearby = content.filter((line) => overlap(line, area) > 0)
    const reaches: Record<Side, number> = {
      right: restOfLine(target, nearby, "right"),
      left: restOfLine(target, nearby, "left"),
      bottom: 0,
      top: 0,
    }
    for (const [sizeIndex, size] of sizes.entries()) {
      for (const side of sides) {
        const length = side === "left" || side === "right" ? size.height : size.width
        for (const spot of spotsBeside(target, size, side, reaches[side])) {
          if (!within(spot.box, bounds)) continue
          const score =
            coveredBy(grow(spot.box, breathingRoom), nearby) +
            coveredBy(grow(caretBox(spot), breathingRoom / 2), nearby) +
            (under(spot.box, pointer) ? cost.pointer : 0) +
            sides.indexOf(side) * cost.side +
            spot.away * cost.away +
            Math.abs(spot.caret - length / 2) * cost.offCenter +
            (widest - size.width) * cost.narrower +
            index * cost.laterTarget -
            (current?.target === index && current.side === side ? cost.keepSide : 0)
          if (score >= bestScore) continue
          bestScore = score
          best = {
            target: index,
            size: sizeIndex,
            side,
            box: spot.box,
            caret: spot.caret,
            covered: 0,
          }
        }
      }
    }
  }
  return best === null ? null : { ...best, covered: coveredBy(best.box, content) }
}
