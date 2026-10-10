import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force"
import { hopsFrom, neighborsOf, ringPositions, type Point, type Scene } from "./model.ts"

interface Body extends SimulationNodeDatum {
  readonly node: number
  readonly radius: number
}

export interface LayoutOptions {
  readonly linkDistance: number
  readonly seed: ReadonlyMap<string, Point>
}

export interface Layout {
  readonly step: (budgetMs: number) => boolean
  readonly positions: () => ReadonlyArray<Point>
}

const goldenAngle = Math.PI * (3 - Math.sqrt(5))

export const tickCount = (nodes: number) =>
  nodes <= 120 ? 160 : nodes <= 400 ? 110 : nodes <= 900 ? 90 : 70

const spiral = (rank: number): Point => {
  const radius = 15 * Math.sqrt(rank + 1)
  return { x: radius * Math.cos(rank * goldenAngle), y: radius * Math.sin(rank * goldenAngle) }
}

const startOf = (scene: Scene, linked: ReadonlyArray<number>, seed: ReadonlyMap<string, Point>) => {
  const starts = new Map<number, Point>()
  if (scene.mode === "page") {
    const root = scene.nodes.findIndex((node) => node.root)
    const hops = hopsFrom(neighborsOf(scene), root === -1 ? [] : [root], 3)
    const rings = new Map<number, Array<number>>()
    for (const node of linked) {
      if (node === root) continue
      const hop = Math.min(3, hops.get(node) ?? 3)
      rings.set(hop, [...(rings.get(hop) ?? []), node])
    }
    for (const [hop, ring] of rings) {
      const ordered = ring.toSorted(
        (left, right) =>
          (scene.nodes[right]?.degree ?? 0) - (scene.nodes[left]?.degree ?? 0) || left - right,
      )
      const radius = 150 + 128 * (hop - 1) + 10 * Math.sqrt(ordered.length)
      ordered.forEach((node, at) => {
        const angle = (at * 2 * Math.PI) / ordered.length + hop * 0.37 + at * goldenAngle * 0.08
        starts.set(node, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
      })
    }
    if (root !== -1) starts.set(root, { x: 0, y: 0 })
  } else {
    linked
      .toSorted(
        (left, right) =>
          Number(scene.nodes[right]?.kind === "tag") - Number(scene.nodes[left]?.kind === "tag") ||
          (scene.nodes[right]?.degree ?? 0) - (scene.nodes[left]?.degree ?? 0) ||
          left - right,
      )
      .forEach((node, rank) => starts.set(node, spiral(rank)))
  }
  for (const node of linked) {
    const kept = seed.get(scene.nodes[node]?.name ?? "")
    if (kept !== undefined) starts.set(node, kept)
  }
  return starts
}

const settle = (scene: Scene, bodies: ReadonlyArray<Body>, isolated: ReadonlyArray<number>) => {
  const positions: Array<Point> = scene.nodes.map(() => ({ x: 0, y: 0 }))
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const { x = 0, y = 0, radius } of bodies) {
    left = Math.min(left, x - radius)
    top = Math.min(top, y - radius)
    right = Math.max(right, x + radius)
    bottom = Math.max(bottom, y + radius)
  }
  const centered = scene.mode === "all" && bodies.length > 0
  const centerX = centered ? (left + right) / 2 : 0
  const centerY = centered ? (top + bottom) / 2 : 0
  for (const { node, x = 0, y = 0 } of bodies) positions[node] = { x: x - centerX, y: y - centerY }
  const reach = bodies.length === 0 ? 0 : Math.max(right - left, bottom - top) / 2
  const ring = ringPositions(isolated.length, Math.max(180, reach) + 96)
  isolated
    .toSorted((a, b) => (scene.nodes[a]?.name ?? "").localeCompare(scene.nodes[b]?.name ?? ""))
    .forEach((node, at) => {
      positions[node] = ring[at] ?? { x: 0, y: 0 }
    })
  return positions
}

export const startLayout = (scene: Scene, { linkDistance, seed }: LayoutOptions): Layout => {
  const page = scene.mode === "page"
  const linked = scene.nodes.flatMap((node, at) => (page || node.degree > 0 ? [at] : []))
  const isolated = page ? [] : scene.nodes.flatMap((node, at) => (node.degree > 0 ? [] : [at]))
  const starts = startOf(scene, linked, seed)
  const bodies: ReadonlyArray<Body> = linked.map((node) => {
    const start = starts.get(node) ?? spiral(node)
    const root = scene.nodes[node]?.root === true
    return {
      node,
      radius: scene.nodes[node]?.radius ?? 4,
      x: start.x,
      y: start.y,
      ...(root ? { fx: 0, fy: 0 } : {}),
    }
  })
  const bodyOf = new Map(bodies.map((body) => [body.node, body]))
  const links = scene.links.flatMap(([from, to]): ReadonlyArray<SimulationLinkDatum<Body>> => {
    const source = bodyOf.get(from)
    const target = bodyOf.get(to)
    return source === undefined || target === undefined ? [] : [{ source, target }]
  })
  const kept = linked.filter((node) => seed.has(scene.nodes[node]?.name ?? "")).length
  const warm = linked.length > 0 && kept / linked.length > 0.5
  const simulation = forceSimulation<Body>([...bodies])
    .force(
      "link",
      forceLink<Body, SimulationLinkDatum<Body>>(links)
        .distance(page ? 118 : linkDistance)
        .strength(0.82),
    )
    .force(
      "charge",
      forceManyBody<Body>()
        .strength(page ? -180 : -140)
        .distanceMax(420),
    )
    .force(
      "collision",
      forceCollide<Body>((body) => body.radius + 10)
        .strength(0.86)
        .iterations(2),
    )
    .force("center", forceCenter(0, 0))
    .alpha(warm ? 0.25 : 1)
    .stop()
  const total = warm ? Math.ceil(tickCount(linked.length) / 2) : tickCount(linked.length)
  let ticks = 0
  let settled: ReadonlyArray<Point> | null = null
  return {
    step: (budgetMs) => {
      const until = performance.now() + budgetMs
      while (ticks < total && performance.now() < until) {
        simulation.tick()
        ticks++
      }
      if (ticks >= total && settled === null) settled = settle(scene, bodies, isolated)
      return settled !== null
    },
    positions: () => settled ?? settle(scene, bodies, isolated),
  }
}

export const layoutNow = (scene: Scene, options: LayoutOptions): ReadonlyArray<Point> => {
  const layout = startLayout(scene, options)
  for (let done = false; !done;) done = layout.step(1000)
  return layout.positions()
}
