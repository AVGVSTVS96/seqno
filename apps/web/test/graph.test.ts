import { assert, describe, it } from "@effect/vitest"
import type { GraphNode, PagesGraph } from "@seqno/rpc"
import { layoutNow } from "../src/ui/graph/layout.ts"
import {
  allPagesScene,
  clickAction,
  countVisible,
  createdRange,
  doubleClickMs,
  fitCamera,
  hopsFrom,
  neighborsOf,
  pageScene,
  pickLabels,
  visibleOf,
  zoomAt,
} from "../src/ui/graph/model.ts"

const node = (
  name: string,
  kind: GraphNode["kind"] = "page",
  created: number | null = 1,
): GraphNode => ({
  name,
  title: name,
  kind,
  created,
})

const graph: PagesGraph = {
  nodes: [
    node("garden", "page", 10),
    node("oct 6th, 2026", "journal", 20),
    node("seeds", "page", 30),
    node("plants", "tag", 40),
    node("alone", "page", 50),
  ],
  links: [
    ["oct 6th, 2026", "garden"],
    ["seeds", "garden"],
    ["seeds", "plants"],
    ["garden", "plants"],
  ],
}

const names = (scene: ReturnType<typeof allPagesScene>) => scene.nodes.map((n) => n.name)

const labelAt = (n: number, x: number, degree: number, pinned = false) => ({
  node: n,
  x,
  y: 0,
  pinned,
  tag: false,
  degree,
})

const everything = { journals: true, orphans: true, until: null }

describe("graph model", () => {
  it("counts each page's links into its degree and size", () => {
    const scene = allPagesScene(graph)
    assert.deepStrictEqual(
      scene.nodes.map((n) => n.degree),
      [3, 1, 2, 2, 0],
    )
    const [garden, , , , alone] = scene.nodes
    assert.isTrue((garden?.radius ?? 0) > (alone?.radius ?? 0))
  })

  it("a page graph holds the page, what it links to, and what links to it except journals", () => {
    const scene = pageScene(graph, "garden")
    assert.deepStrictEqual(names(scene), ["garden", "seeds", "plants"])
    assert.isTrue(scene.nodes[0]?.root)
    assert.deepStrictEqual(pageScene(graph, "missing").nodes, [])
  })

  it("hides journals and orphans by setting, and pages created after the time travel point", () => {
    const scene = allPagesScene(graph)
    assert.deepStrictEqual(visibleOf(scene, everything), [true, true, true, true, true])
    assert.deepStrictEqual(visibleOf(scene, { journals: false, orphans: false, until: null }), [
      true,
      false,
      true,
      true,
      false,
    ])
    assert.deepStrictEqual(visibleOf(scene, { ...everything, until: 30 }), [
      true,
      true,
      true,
      false,
      false,
    ])
    assert.deepStrictEqual(countVisible(scene, visibleOf(scene, { ...everything, until: 30 })), {
      nodes: 3,
      links: 2,
    })
    assert.deepStrictEqual(createdRange(scene), { first: 10, last: 50 })
  })

  it("walks neighbors out to the chosen depth", () => {
    const scene = allPagesScene(graph)
    const hops = hopsFrom(neighborsOf(scene), [1], 2)
    assert.deepStrictEqual(
      [...hops].toSorted(([a], [b]) => a - b),
      [
        [0, 1],
        [1, 0],
        [2, 2],
        [3, 2],
      ],
    )
  })

  it("a click selects, a quick second click opens, shift-click goes to the sidebar", () => {
    const first = { node: 2, at: 0 }
    assert.strictEqual(clickAction(null, first, { shift: false, selected: false }), "select")
    assert.strictEqual(
      clickAction(first, { node: 2, at: doubleClickMs }, { shift: false, selected: true }),
      "open",
    )
    assert.strictEqual(
      clickAction(first, { node: 2, at: doubleClickMs + 1 }, { shift: false, selected: true }),
      "unselect",
    )
    assert.strictEqual(clickAction(null, first, { shift: true, selected: false }), "sidebar")
  })

  it("zooms around the pointer and fits every node in view", () => {
    const camera = zoomAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 50 }, 2)
    assert.deepStrictEqual(camera, { x: -100, y: -50, scale: 2 })
    const fitted = fitCamera(
      [
        { x: -500, y: 0, radius: 0 },
        { x: 500, y: 0, radius: 0 },
      ],
      600,
      400,
      0,
    )
    assert.strictEqual(fitted.scale, 0.6)
    assert.strictEqual(fitted.x, 300)
  })

  it("labels the busiest nodes first and skips ones that would overlap", () => {
    assert.deepStrictEqual(
      pickLabels([labelAt(0, 0, 1), labelAt(1, 10, 5), labelAt(2, 400, 0)], 10),
      [1, 2],
    )
    assert.deepStrictEqual(pickLabels([labelAt(0, 0, 1, true), labelAt(1, 10, 5)], 10), [0])
  })

  it("lays out the same graph the same way every time, linked pages closer than orphans", () => {
    const scene = allPagesScene(graph)
    const options = { linkDistance: 72, seed: new Map() }
    const first = layoutNow(scene, options)
    assert.deepStrictEqual(layoutNow(scene, options), first)
    const distance = (a: number, b: number) =>
      Math.hypot((first[a]?.x ?? 0) - (first[b]?.x ?? 0), (first[a]?.y ?? 0) - (first[b]?.y ?? 0))
    assert.isTrue(distance(0, 2) < distance(0, 4))
  })
})
