import type { GraphNode, GraphNodeKind, PagesGraph } from "@seqno/rpc"

export type GraphMode = "all" | "page"

export interface SceneNode {
  readonly name: string
  readonly title: string
  readonly kind: GraphNodeKind
  readonly created: number | null
  readonly degree: number
  readonly radius: number
  readonly root: boolean
}

export type SceneLink = readonly [source: number, target: number]

export interface Scene {
  readonly mode: GraphMode
  readonly nodes: ReadonlyArray<SceneNode>
  readonly links: ReadonlyArray<SceneLink>
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Camera {
  readonly x: number
  readonly y: number
  readonly scale: number
}

export const minScale = 0.05
export const maxScale = 3.6
export const doubleClickMs = 320

export const nodeRadius = (kind: GraphNodeKind, degree: number) =>
  kind === "tag"
    ? 7.4 + Math.min(15, 4.1 * Math.sqrt(degree))
    : (kind === "journal" ? 4.4 : 3.8) + Math.min(12, 3.4 * Math.sqrt(degree))

const sceneOf = (
  mode: GraphMode,
  nodes: ReadonlyArray<GraphNode>,
  links: ReadonlyArray<readonly [string, string]>,
  root: string | null,
): Scene => {
  const indexOf = new Map(nodes.map((node, at) => [node.name, at]))
  const kept = links.flatMap(([source, target]): ReadonlyArray<SceneLink> => {
    const from = indexOf.get(source)
    const to = indexOf.get(target)
    return from === undefined || to === undefined || from === to ? [] : [[from, to]]
  })
  const degrees = nodes.map(() => 0)
  for (const [from, to] of kept) {
    degrees[from] = (degrees[from] ?? 0) + 1
    degrees[to] = (degrees[to] ?? 0) + 1
  }
  return {
    mode,
    nodes: nodes.map((node, at) => {
      const degree = degrees[at] ?? 0
      return { ...node, degree, radius: nodeRadius(node.kind, degree), root: node.name === root }
    }),
    links: kept,
  }
}

export const allPagesScene = (graph: PagesGraph): Scene =>
  sceneOf("all", graph.nodes, graph.links, null)

export const pageScene = (graph: PagesGraph, name: string): Scene => {
  const byName = new Map(graph.nodes.map((node) => [node.name, node]))
  const root = byName.get(name)
  if (root === undefined) return { mode: "page", nodes: [], links: [] }
  const around = new Set<string>()
  for (const [source, target] of graph.links) {
    if (source === name) around.add(target)
    else if (target === name && byName.get(source)?.kind !== "journal") around.add(source)
  }
  around.delete(name)
  const nodes = [root, ...[...around].flatMap((other) => byName.get(other) ?? [])]
  return sceneOf("page", nodes, graph.links, name)
}

export const sameScene = (left: Scene, right: Scene) =>
  left.mode === right.mode &&
  left.nodes.length === right.nodes.length &&
  left.links.length === right.links.length &&
  left.nodes.every((node, at) => {
    const other = right.nodes[at]
    return (
      other !== undefined &&
      node.name === other.name &&
      node.title === other.title &&
      node.kind === other.kind &&
      node.created === other.created &&
      node.degree === other.degree &&
      node.root === other.root
    )
  }) &&
  left.links.every(([from, to], at) => right.links[at]?.[0] === from && right.links[at]?.[1] === to)

export const neighborsOf = (scene: Scene): ReadonlyArray<ReadonlyArray<number>> => {
  const neighbors = scene.nodes.map((): Array<number> => [])
  for (const [from, to] of scene.links) {
    neighbors[from]?.push(to)
    neighbors[to]?.push(from)
  }
  return neighbors
}

export const hopsFrom = (
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
  starts: Iterable<number>,
  depth: number,
  limit = Number.POSITIVE_INFINITY,
): ReadonlyMap<number, number> => {
  const hops = new Map<number, number>()
  const queue: Array<number> = []
  for (const start of starts) {
    hops.set(start, 0)
    queue.push(start)
  }
  for (let at = 0; at < queue.length && hops.size < limit; at++) {
    const node = queue[at] ?? 0
    const hop = hops.get(node) ?? 0
    if (hop >= depth) continue
    for (const next of neighbors[node] ?? []) {
      if (hops.has(next)) continue
      hops.set(next, hop + 1)
      queue.push(next)
    }
  }
  return hops
}

export const dragWeights = (
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
  start: number,
  depth: number,
): ReadonlyMap<number, number> =>
  new Map(
    [...hopsFrom(neighbors, [start], depth, 1200)].map(([node, hop]) => [
      node,
      Math.max(0.2, 0.72 ** hop),
    ]),
  )

export interface Visibility {
  readonly journals: boolean
  readonly orphans: boolean
  readonly until: number | null
}

export const visibleOf = (
  scene: Scene,
  { journals, orphans, until }: Visibility,
): ReadonlyArray<boolean> =>
  scene.nodes.map(
    (node) =>
      node.root ||
      ((scene.mode === "page" || journals || node.kind !== "journal") &&
        (scene.mode === "page" || orphans || node.degree > 0) &&
        (until === null || node.created === null || node.created <= until)),
  )

export const countVisible = (scene: Scene, visible: ReadonlyArray<boolean>) => ({
  nodes: visible.filter(Boolean).length,
  links: scene.links.filter(([from, to]) => visible[from] === true && visible[to] === true).length,
})

export interface TimeRange {
  readonly first: number
  readonly last: number
}

export const createdRange = (scene: Scene): TimeRange | null => {
  const times = scene.nodes.flatMap((node) => (node.created === null ? [] : [node.created]))
  if (times.length === 0) return null
  const first = Math.min(...times)
  const last = Math.max(...times)
  return last > first ? { first, last } : null
}

export type ClickAction = "sidebar" | "open" | "select" | "unselect"

export interface Click {
  readonly node: number
  readonly at: number
}

export const clickAction = (
  previous: Click | null,
  click: Click,
  { shift, selected }: { readonly shift: boolean; readonly selected: boolean },
): ClickAction => {
  if (shift) return "sidebar"
  if (previous !== null && previous.node === click.node && click.at - previous.at <= doubleClickMs)
    return "open"
  return selected ? "unselect" : "select"
}

export const clampScale = (scale: number) => Math.min(maxScale, Math.max(minScale, scale))

export const zoomAt = (camera: Camera, screen: Point, factor: number): Camera => {
  const scale = clampScale(camera.scale * factor)
  const worldX = (screen.x - camera.x) / camera.scale
  const worldY = (screen.y - camera.y) / camera.scale
  return { x: screen.x - worldX * scale, y: screen.y - worldY * scale, scale }
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly radius: number
}

export const fitCamera = (
  boxes: ReadonlyArray<Box>,
  width: number,
  height: number,
  padding = 72,
): Camera => {
  if (boxes.length === 0) return { x: width / 2, y: height / 2, scale: 1 }
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const { x, y, radius } of boxes) {
    left = Math.min(left, x - radius)
    top = Math.min(top, y - radius)
    right = Math.max(right, x + radius)
    bottom = Math.max(bottom, y + radius)
  }
  const scale = clampScale(
    Math.min(
      1,
      Math.max(1, width - 2 * padding) / Math.max(1, right - left),
      Math.max(1, height - 2 * padding) / Math.max(1, bottom - top),
    ),
  )
  return {
    x: width / 2 - ((left + right) / 2) * scale,
    y: height / 2 - ((top + bottom) / 2) * scale,
    scale,
  }
}

export const labelText = (title: string, full: boolean) => {
  const most = full ? 96 : 19
  return title.length > most ? `${title.slice(0, most)}...` : title
}

export interface LabelCandidate {
  readonly node: number
  readonly x: number
  readonly y: number
  readonly pinned: boolean
  readonly tag: boolean
  readonly degree: number
}

export const pickLabels = (
  candidates: ReadonlyArray<LabelCandidate>,
  most: number,
): ReadonlyArray<number> => {
  const ranked = candidates.toSorted(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      Number(right.tag) - Number(left.tag) ||
      right.degree - left.degree ||
      left.node - right.node,
  )
  const taken = new Set<string>()
  const picked: Array<number> = []
  for (const candidate of ranked) {
    if (picked.length >= most) break
    const cell = `${Math.floor(candidate.x / 140)}:${Math.floor(candidate.y / 26)}`
    if (taken.has(cell) && !candidate.pinned) continue
    taken.add(cell)
    picked.push(candidate.node)
  }
  return picked
}

export const ringPositions = (count: number, from: number): ReadonlyArray<Point> => {
  const points: Array<Point> = []
  for (let ring = 0; points.length < count; ring++) {
    const radius = from + ring * 58
    const room = Math.max(14, Math.floor((2 * Math.PI * radius) / 42))
    const here = Math.min(room, count - points.length)
    for (let at = 0; at < here; at++) {
      const angle = ring * 0.41 + (at * 2 * Math.PI) / here
      points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
    }
  }
  return points
}
