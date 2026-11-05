import type { Vec } from "@seqno/domain"

export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface Camera {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const ZOOM_STEP = 0.8
export const FIT_PADDING = 100
export const GRID_SIZE = 8
export const BINDING_GAP = 4

export const origin: Camera = { x: 0, y: 0, zoom: 1 }

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export const toWorld = (camera: Camera, [x, y]: Vec): Vec => [
  x / camera.zoom - camera.x,
  y / camera.zoom - camera.y,
]

export const toScreen = (camera: Camera, [x, y]: Vec): Vec => [
  (x + camera.x) * camera.zoom,
  (y + camera.y) * camera.zoom,
]

export const panBy = (camera: Camera, [dx, dy]: Vec): Camera => ({
  ...camera,
  x: camera.x + dx / camera.zoom,
  y: camera.y + dy / camera.zoom,
})

export const zoomAt = (camera: Camera, at: Vec, zoom: number): Camera => {
  const next = clampZoom(zoom)
  const [wx, wy] = toWorld(camera, at)

  return { x: at[0] / next - wx, y: at[1] / next - wy, zoom: next }
}

export const center = (viewport: Viewport): Vec => [viewport.width / 2, viewport.height / 2]

export const fitBounds = (
  bounds: Bounds,
  viewport: Viewport,
  most = 1,
  padding = FIT_PADDING,
): Camera => {
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)

  const zoom = clampZoom(
    Math.min(most, (viewport.width - padding) / width, (viewport.height - padding) / height),
  )

  return {
    x: viewport.width / 2 / zoom - (bounds.minX + width / 2),
    y: viewport.height / 2 / zoom - (bounds.minY + height / 2),
    zoom,
  }
}

export const visibleBounds = (camera: Camera, viewport: Viewport): Bounds => {
  const [minX, minY] = toWorld(camera, [0, 0])
  const [maxX, maxY] = toWorld(camera, [viewport.width, viewport.height])

  return { minX, minY, maxX, maxY }
}

export const boundsOfPoints = (points: readonly Vec[]): Bounds =>
  points.reduce<Bounds>(
    (box, [x, y]) => ({
      minX: Math.min(box.minX, x),
      minY: Math.min(box.minY, y),
      maxX: Math.max(box.maxX, x),
      maxY: Math.max(box.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )

export const boxBounds = ([x, y]: Vec, [width, height]: Vec): Bounds => ({
  minX: x,
  minY: y,
  maxX: x + width,
  maxY: y + height,
})

export const union = (all: readonly Bounds[]): Bounds | null =>
  all.length === 0
    ? null
    : all.reduce((box, next) => ({
        minX: Math.min(box.minX, next.minX),
        minY: Math.min(box.minY, next.minY),
        maxX: Math.max(box.maxX, next.maxX),
        maxY: Math.max(box.maxY, next.maxY),
      }))

export const expand = (box: Bounds, by: number): Bounds => ({
  minX: box.minX - by,
  minY: box.minY - by,
  maxX: box.maxX + by,
  maxY: box.maxY + by,
})

export const contains = (box: Bounds, [x, y]: Vec) =>
  x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY

export const overlaps = (a: Bounds, b: Bounds) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

export const encloses = (outer: Bounds, inner: Bounds) =>
  inner.minX >= outer.minX &&
  inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY &&
  inner.maxY <= outer.maxY

export const centerOf = (box: Bounds): Vec => [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]

export const sizeOf = (box: Bounds): Vec => [box.maxX - box.minX, box.maxY - box.minY]

export const add = ([ax, ay]: Vec, [bx, by]: Vec): Vec => [ax + bx, ay + by]

export const sub = ([ax, ay]: Vec, [bx, by]: Vec): Vec => [ax - bx, ay - by]

export const length = ([x, y]: Vec) => Math.hypot(x, y)

export const distanceToSegment = (point: Vec, a: Vec, b: Vec) => {
  const [dx, dy] = sub(b, a)
  const span = dx * dx + dy * dy

  const t =
    span === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / span))

  return length(sub(point, [a[0] + t * dx, a[1] + t * dy]))
}

export const distanceToPolyline = (point: Vec, points: readonly Vec[]) => {
  const first = points[0]

  if (first === undefined) {
    return Infinity
  }

  if (points.length === 1) {
    return length(sub(point, first))
  }

  let best = Infinity

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]

    if (a !== undefined && b !== undefined) {
      best = Math.min(best, distanceToSegment(point, a, b))
    }
  }

  return best
}

export const toward = (from: Vec, to: Vec, by: number): Vec => {
  const delta = sub(to, from)
  const span = length(delta)

  return span === 0 ? from : [from[0] + (delta[0] / span) * by, from[1] + (delta[1] / span) * by]
}

export const rectEdge = (box: Bounds, from: Vec): Vec => {
  const [cx, cy] = centerOf(box)
  const [dx, dy] = sub(from, [cx, cy])
  const halfW = (box.maxX - box.minX) / 2
  const halfH = (box.maxY - box.minY) / 2

  if (dx === 0 && dy === 0) {
    return [cx, cy]
  }

  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  )

  return scale >= 1 ? [cx, cy] : [cx + dx * scale, cy + dy * scale]
}

export const ellipseEdge = (box: Bounds, from: Vec): Vec => {
  const [cx, cy] = centerOf(box)
  const [dx, dy] = sub(from, [cx, cy])
  const rx = (box.maxX - box.minX) / 2
  const ry = (box.maxY - box.minY) / 2

  if ((dx === 0 && dy === 0) || rx === 0 || ry === 0) {
    return [cx, cy]
  }

  const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry))

  return scale >= 1 ? [cx, cy] : [cx + dx * scale, cy + dy * scale]
}

export const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE

export const round = (value: number) => Math.round(value * 100) / 100

const TAU = Math.PI * 2

export const rotateAround = ([x, y]: Vec, [cx, cy]: Vec, r: number): Vec => {
  if (r === 0) {
    return [x, y]
  }

  const sin = Math.sin(r)
  const cos = Math.cos(r)

  return [(x - cx) * cos - (y - cy) * sin + cx, (x - cx) * sin + (y - cy) * cos + cy]
}

export const angleOf = (from: Vec, to: Vec) => Math.atan2(to[1] - from[1], to[0] - from[0])

export const clampRadians = (r: number) => (TAU + r) % TAU

export const snapRadians = (r: number, segments = 24) => {
  const segment = TAU / segments
  const snapped = (Math.floor((clampRadians(r) + segment / 2) / segment) * segment) % TAU
  const up = snapped < Math.PI ? snapped + TAU : snapped

  return up > Math.PI ? up - TAU : up
}

export const cornersOf = (box: Bounds, r: number): readonly Vec[] => {
  const middle = centerOf(box)

  const corners: readonly Vec[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ]

  return corners.map((corner) => rotateAround(corner, middle, r))
}

export const rotatedBox = (box: Bounds, r: number): Bounds =>
  r === 0 ? box : boundsOfPoints(cornersOf(box, r))

const projected = (points: readonly Vec[], axis: Vec) => {
  const dots = points.map(([x, y]) => x * axis[0] + y * axis[1])

  return [Math.min(...dots), Math.max(...dots)] as const
}

export const polygonsOverlap = (a: readonly Vec[], b: readonly Vec[]) =>
  [a, b].every((shape) =>
    shape.every((point, index) => {
      const next = shape[(index + 1) % shape.length] ?? point
      const axis: Vec = [point[1] - next[1], next[0] - point[0]]
      const [aMin, aMax] = projected(a, axis)
      const [bMin, bMax] = projected(b, axis)

      return aMax >= bMin && bMax >= aMin
    }),
  )
