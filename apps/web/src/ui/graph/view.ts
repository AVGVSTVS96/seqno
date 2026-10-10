import { startLayout, type Layout } from "./layout.ts"
import {
  clickAction,
  dragWeights,
  fitCamera,
  hopsFrom,
  labelText,
  neighborsOf,
  pickLabels,
  visibleOf,
  zoomAt,
  type Camera,
  type Click,
  type Point,
  type Scene,
  type SceneNode,
  type Visibility,
} from "./model.ts"

export type Theme = "light" | "dark"

interface Palette {
  readonly page: string
  readonly journal: string
  readonly tag: string
  readonly root: string
  readonly edge: string
  readonly label: string
  readonly labelBackground: string
  readonly labelBorder: string
}

const palettes: Readonly<Record<Theme, Palette>> = {
  light: {
    page: "#cbd5e1",
    journal: "#0284c7",
    tag: "#8b5cf6",
    root: "#2563eb",
    edge: "#94a3b8",
    label: "#0f172a",
    labelBackground: "#ffffff",
    labelBorder: "#cbd5e1",
  },
  dark: {
    page: "#9ca3af",
    journal: "#7dd3fc",
    tag: "#a78bfa",
    root: "#93c5fd",
    edge: "#64748b",
    label: "#e2e8f0",
    labelBackground: "#123f49",
    labelBorder: "#5e7d88",
  },
}

export interface GraphViewEvents {
  readonly open: (name: string) => void
  readonly sidebar: (name: string) => void
  readonly select: (nodes: ReadonlyArray<{ readonly name: string; readonly title: string }>) => void
  readonly ready: (ready: boolean) => void
}

interface Dot {
  x: number
  y: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  alpha: number
  scale: number
}

interface Drawn {
  readonly scene: Scene
  readonly dots: ReadonlyArray<Dot>
  readonly neighbors: ReadonlyArray<ReadonlyArray<number>>
  readonly reciprocal: ReadonlyArray<boolean>
}

interface Drag {
  readonly node: number
  readonly offsetX: number
  readonly offsetY: number
  readonly startX: number
  readonly startY: number
  readonly bases: ReadonlyMap<number, Point>
  readonly weights: ReadonlyMap<number, number>
  moved: boolean
}

interface Pan {
  readonly startX: number
  readonly startY: number
  readonly camera: Camera
  moved: boolean
}

const font = '11px "Inter Variable", Inter, system-ui, sans-serif'
const labelHeight = 14
const frameMs = 1000 / 60
const morphMs = 420
const largeGraph = 2500

const approach = (current: number, target: number, rate: number, dt: number) => {
  const next = current + (target - current) * (1 - (1 - rate) ** (dt / frameMs))
  return Math.abs(target - next) < 0.004 ? target : next
}

const ease = (t: number) => 1 - (1 - t) ** 3

const emphasisScale = { selected: 1.55, hovered: 1.42, connected: 1.22, dimmed: 1, normal: 1 }
const emphasisAlpha = { selected: 1, hovered: 1, connected: 0.95, dimmed: 0.16, normal: 1 }

const densityAlpha = (node: SceneNode, emphasized: boolean, scale: number) =>
  node.kind === "tag" || emphasized || scale >= 0.72
    ? 1
    : node.degree >= 8
      ? 0.88
      : Math.max(0.32, Math.min(1, 0.3 + scale * 0.76))

const drawnOf = (scene: Scene, positions: ReadonlyArray<Point>, from: Drawn | null): Drawn => {
  const previous = new Map<string, Dot>()
  if (from !== null)
    from.scene.nodes.forEach((node, at) => {
      const dot = from.dots[at]
      if (dot !== undefined) previous.set(node.name, dot)
    })
  const pairs = new Set(scene.links.map(([source, target]) => `${source}:${target}`))
  return {
    scene,
    neighbors: neighborsOf(scene),
    reciprocal: scene.links.map(([source, target]) => pairs.has(`${target}:${source}`)),
    dots: scene.nodes.map((node, at) => {
      const to = positions[at] ?? { x: 0, y: 0 }
      const was = previous.get(node.name)
      return {
        x: was?.x ?? to.x,
        y: was?.y ?? to.y,
        fromX: was?.x ?? to.x,
        fromY: was?.y ?? to.y,
        toX: to.x,
        toY: to.y,
        alpha: was?.alpha ?? 0,
        scale: was?.scale ?? 1,
      }
    }),
  }
}

export const createGraphView = (events: GraphViewEvents) => {
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null
  let width = 0
  let height = 0
  let ratio = 1
  let palette = palettes.light
  let drawn: Drawn | null = null
  let pending: { readonly scene: Scene; readonly layout: Layout } | null = null
  let waiting: Scene | null = null
  let visibility: Visibility = { journals: true, orphans: true, until: null }
  let visible: ReadonlyArray<boolean> = []
  let linkDistance = 72
  let depth = 1
  let camera: Camera = { x: 0, y: 0, scale: 1 }
  let target: Camera | null = null
  let fitted = false
  let morph = 1
  let selected = new Set<number>()
  let active: ReadonlyMap<number, number> = new Map()
  let hovered: number | null = null
  let labelsOn = false
  let labelAlpha = 0
  let lastClick: Click | null = null
  let drag: Drag | null = null
  let pan: Pan | null = null
  let frame: number | null = null
  let last = 0
  const widths = new Map<string, number>()

  const request = () => {
    if (frame === null && canvas !== null) frame = requestAnimationFrame(tick)
  }

  const emitSelection = () => {
    const current = drawn
    events.select(
      current === null
        ? []
        : [...selected].flatMap((at) => {
            const node = current.scene.nodes[at]
            return node === undefined ? [] : [{ name: node.name, title: node.title }]
          }),
    )
  }

  const refreshActive = () => {
    active = drawn === null ? new Map() : hopsFrom(drawn.neighbors, selected, depth)
  }

  const refreshVisible = () => {
    visible = drawn === null ? [] : visibleOf(drawn.scene, visibility)
    const kept = new Set([...selected].filter((node) => visible[node] === true))
    if (kept.size !== selected.size) {
      selected = kept
      refreshActive()
      emitSelection()
    }
  }

  const fit = () =>
    drawn === null
      ? camera
      : fitCamera(
          drawn.dots.flatMap((dot, at) =>
            visible[at] === true
              ? [{ x: dot.toX, y: dot.toY, radius: drawn?.scene.nodes[at]?.radius ?? 0 }]
              : [],
          ),
          width,
          height,
        )

  const relayout = (scene: Scene, warm: boolean) => {
    const seed = new Map<string, Point>()
    if (drawn !== null && warm) {
      const current = drawn
      current.scene.nodes.forEach((node, at) => {
        const dot = current.dots[at]
        if (dot !== undefined) seed.set(node.name, { x: dot.toX, y: dot.toY })
      })
    }
    pending = { scene, layout: startLayout(scene, { linkDistance, seed }) }
    if (drawn === null) events.ready(false)
    request()
  }

  const land = (scene: Scene, positions: ReadonlyArray<Point>) => {
    const names = new Set(
      drawn === null ? [] : [...selected].flatMap((node) => drawn?.scene.nodes[node]?.name ?? []),
    )
    const first = drawn === null
    drawn = drawnOf(scene, positions, drawn)
    morph = first ? 1 : 0
    selected = new Set(scene.nodes.flatMap((node, at) => (names.has(node.name) ? [at] : [])))
    hovered = null
    refreshVisible()
    refreshActive()
    emitSelection()
    if (first) events.ready(true)
    if (!fitted && width > 0) {
      camera = fit()
      fitted = true
    }
  }

  const screenToWorld = (x: number, y: number): Point => ({
    x: (x - camera.x) / camera.scale,
    y: (y - camera.y) / camera.scale,
  })

  const pointOf = (event: PointerEvent | WheelEvent): Point => {
    const box = canvas?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }

  const nodeAt = (screen: Point): number | null => {
    if (drawn === null) return null
    const world = screenToWorld(screen.x, screen.y)
    const slack = 24 / Math.max(camera.scale, 0.5)
    let best: number | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    drawn.dots.forEach((dot, at) => {
      if (visible[at] !== true) return
      const distance = Math.hypot(world.x - dot.x, world.y - dot.y)
      const reach = (drawn?.scene.nodes[at]?.radius ?? 0) + slack
      if (distance <= reach && distance < bestDistance) {
        best = at
        bestDistance = distance
      }
    })
    return best
  }

  const setHovered = (node: number | null) => {
    if (node === hovered) return
    hovered = node
    if (canvas !== null) canvas.style.cursor = node === null ? "" : "pointer"
    request()
  }

  const click = (node: number, event: PointerEvent) => {
    const current = drawn
    const name = current?.scene.nodes[node]?.name
    if (current === null || name === undefined) return
    const now = { node, at: performance.now() }
    const action = clickAction(lastClick, now, {
      shift: event.shiftKey,
      selected: selected.has(node),
    })
    lastClick = action === "select" || action === "unselect" ? now : null
    if (action === "open") return events.open(name)
    if (action === "sidebar") return events.sidebar(name)
    const next = new Set(selected)
    if (action === "select") next.add(node)
    else next.delete(node)
    selected = next
    refreshActive()
    emitSelection()
    request()
  }

  const clearSelection = () => {
    lastClick = null
    if (selected.size === 0) return
    selected = new Set()
    refreshActive()
    emitSelection()
    request()
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || canvas === null) return
    canvas.setPointerCapture(event.pointerId)
    target = null
    const screen = pointOf(event)
    const node = nodeAt(screen)
    const dot = node === null ? undefined : drawn?.dots[node]
    setHovered(null)
    if (node !== null && dot !== undefined && drawn !== null) {
      const world = screenToWorld(screen.x, screen.y)
      const weights = dragWeights(drawn.neighbors, node, depth)
      const bases = new Map<number, Point>()
      for (const moving of weights.keys()) {
        const base = drawn.dots[moving]
        if (base !== undefined) bases.set(moving, { x: base.x, y: base.y })
      }
      drag = {
        node,
        offsetX: world.x - dot.x,
        offsetY: world.y - dot.y,
        startX: dot.x,
        startY: dot.y,
        bases,
        weights,
        moved: false,
      }
    } else {
      pan = { startX: screen.x, startY: screen.y, camera, moved: false }
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    const screen = pointOf(event)
    if (drag !== null && drawn !== null) {
      const world = screenToWorld(screen.x, screen.y)
      const dx = world.x - drag.offsetX - drag.startX
      const dy = world.y - drag.offsetY - drag.startY
      if (Math.abs(dx) > 0.45 || Math.abs(dy) > 0.45) drag.moved = true
      if (!drag.moved) return
      for (const [moving, weight] of drag.weights) {
        const dot = drawn.dots[moving]
        const base = drag.bases.get(moving)
        if (dot === undefined || base === undefined) continue
        dot.x = dot.toX = dot.fromX = base.x + dx * weight
        dot.y = dot.toY = dot.fromY = base.y + dy * weight
      }
      if (canvas !== null) canvas.style.cursor = "grabbing"
      request()
      return
    }
    if (pan !== null) {
      const dx = screen.x - pan.startX
      const dy = screen.y - pan.startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true
      camera = { ...pan.camera, x: pan.camera.x + dx, y: pan.camera.y + dy }
      request()
      return
    }
    setHovered(nodeAt(screen))
  }

  const onPointerUp = (event: PointerEvent) => {
    const screen = pointOf(event)
    if (drag !== null) {
      const { node, moved } = drag
      drag = null
      if (canvas !== null) canvas.style.cursor = ""
      if (!moved) click(node, event)
      setHovered(nodeAt(screen))
      return
    }
    if (pan !== null) {
      const { moved } = pan
      pan = null
      if (moved) return
      const node = nodeAt(screen)
      if (node === null) clearSelection()
      else click(node, event)
    }
  }

  const onPointerLeave = () => {
    if (drag === null && pan === null) setHovered(null)
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    target = null
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
    const speed = event.ctrlKey ? 0.01 : 0.001
    camera = zoomAt(camera, pointOf(event), Math.exp(-event.deltaY * lines * speed))
    setHovered(nodeAt(pointOf(event)))
    request()
  }

  const resize = (nextWidth: number, nextHeight: number) => {
    if (canvas === null || nextWidth === 0 || nextHeight === 0) return
    ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(nextWidth * ratio)
    canvas.height = Math.round(nextHeight * ratio)
    if (fitted) {
      camera = {
        ...camera,
        x: camera.x + (nextWidth - width) / 2,
        y: camera.y + (nextHeight - height) / 2,
      }
    }
    width = nextWidth
    height = nextHeight
    if (!fitted && drawn !== null) {
      camera = fit()
      fitted = true
    }
    request()
  }

  const labelWidth = (text: string) => {
    const known = widths.get(text)
    if (known !== undefined || context === null) return known ?? 0
    const measured = context.measureText(text).width
    widths.set(text, measured)
    return measured
  }

  const colorOf = (node: SceneNode) =>
    node.root ? palette.root : node.kind === "tag" ? palette.tag : palette[node.kind]

  const draw = (current: Drawn) => {
    if (context === null) return
    const ctx = context
    const { scene, dots } = current
    const { x: cx, y: cy, scale } = camera
    const page = scene.mode === "page"
    const selecting = selected.size > 0
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * cx, ratio * cy)
    const pad = 40 / scale
    const left = -cx / scale - pad
    const top = -cy / scale - pad
    const right = (width - cx) / scale + pad
    const bottom = (height - cy) / scale + pad

    const edges = new Map<number, Path2D>()
    scene.links.forEach(([source, sink], at) => {
      if (visible[source] !== true || visible[sink] !== true) return
      const from = dots[source]
      const to = dots[sink]
      if (from === undefined || to === undefined) return
      if (
        Math.max(from.x, to.x) < left ||
        Math.min(from.x, to.x) > right ||
        Math.max(from.y, to.y) < top ||
        Math.min(from.y, to.y) > bottom
      )
        return
      const alpha = !selecting
        ? 0.54
        : (selected.has(source) && active.has(sink)) || (selected.has(sink) && active.has(source))
          ? 0.82
          : active.has(source) && active.has(sink)
            ? 0.46
            : 0.18
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.max(1, Math.hypot(dx, dy))
      const ux = dx / length
      const uy = dy / length
      const shift = current.reciprocal[at] === true ? 5 : 0
      const startGap = (scene.nodes[source]?.radius ?? 0) + 3
      const endGap = (scene.nodes[sink]?.radius ?? 0) + 5
      const x1 = from.x + ux * startGap - uy * shift
      const y1 = from.y + uy * startGap + ux * shift
      const x2 = to.x - ux * endGap - uy * shift
      const y2 = to.y - uy * endGap + ux * shift
      const path = edges.get(alpha) ?? new Path2D()
      edges.set(alpha, path)
      path.moveTo(x1, y1)
      path.lineTo(x2, y2)
      if (page) {
        const baseX = x2 - ux * 6.8
        const baseY = y2 - uy * 6.8
        path.moveTo(x2, y2)
        path.lineTo(baseX - uy * 3.3, baseY + ux * 3.3)
        path.moveTo(x2, y2)
        path.lineTo(baseX + uy * 3.3, baseY - ux * 3.3)
      }
    })
    ctx.strokeStyle = palette.edge
    ctx.lineWidth = selecting ? 1.25 : 1
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    for (const [alpha, path] of edges) {
      ctx.globalAlpha = alpha
      ctx.stroke(path)
    }

    const nodeScale = page ? 0.72 : 1
    const batches = new Map<string, Path2D>()
    const front: Array<number> = []
    dots.forEach((dot, at) => {
      const node = scene.nodes[at]
      if (node === undefined || dot.alpha < 0.01) return
      if (dot.scale > 1.001) {
        front.push(at)
        return
      }
      const radius = node.radius * nodeScale
      if (dot.x + radius < left || dot.x - radius > right) return
      if (dot.y + radius < top || dot.y - radius > bottom) return
      if (dot.alpha > 0.995) {
        const color = colorOf(node)
        const path = batches.get(color) ?? new Path2D()
        batches.set(color, path)
        path.moveTo(dot.x + radius, dot.y)
        path.arc(dot.x, dot.y, radius, 0, 2 * Math.PI)
        return
      }
      ctx.globalAlpha = dot.alpha
      ctx.fillStyle = colorOf(node)
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, radius, 0, 2 * Math.PI)
      ctx.fill()
    })
    ctx.globalAlpha = 1
    for (const [color, path] of batches) {
      ctx.fillStyle = color
      ctx.fill(path)
    }
    front
      .toSorted((a, b) => (dots[a]?.scale ?? 1) - (dots[b]?.scale ?? 1))
      .forEach((at) => {
        const dot = dots[at]
        const node = scene.nodes[at]
        if (dot === undefined || node === undefined) return
        ctx.globalAlpha = dot.alpha
        ctx.fillStyle = colorOf(node)
        ctx.beginPath()
        ctx.arc(dot.x, dot.y, node.radius * nodeScale * dot.scale, 0, 2 * Math.PI)
        ctx.fill()
      })

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (labelAlpha < 0.01) return
    const shown = labels(current, left, top, right, bottom)
    ctx.font = font
    ctx.textBaseline = "middle"
    for (const at of shown) {
      const dot = dots[at]
      const node = scene.nodes[at]
      if (dot === undefined || node === undefined || dot.alpha < 0.01) continue
      const full = at === hovered
      const text = labelText(node.title, full)
      const size = full ? 1.22 : 1
      const x = (dot.x + node.radius * nodeScale * dot.scale + 8) * scale + cx
      const y = dot.y * scale + cy
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(size, size)
      ctx.beginPath()
      ctx.roundRect(-3, -labelHeight / 2 - 2, labelWidth(text) + 8, labelHeight + 4, 4)
      ctx.globalAlpha = labelAlpha * (full ? 0.88 : 0.68)
      ctx.fillStyle = palette.labelBackground
      ctx.fill()
      ctx.globalAlpha = labelAlpha * (full ? 0.36 : 0.18)
      ctx.strokeStyle = palette.labelBorder
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = labelAlpha * 0.98
      ctx.fillStyle = palette.label
      ctx.fillText(text, 1, 0)
      ctx.restore()
    }
  }

  const labels = (
    current: Drawn,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): ReadonlyArray<number> => {
    const { scene, dots } = current
    const selecting = selected.size > 0
    const pool = selecting ? [...active.keys()] : labelsOn ? scene.nodes.map((_, at) => at) : []
    const candidates = [...pool, ...(hovered === null ? [] : [hovered])].flatMap((at) => {
      const dot = dots[at]
      const node = scene.nodes[at]
      if (dot === undefined || node === undefined || visible[at] !== true) return []
      if (dot.x < left || dot.x > right || dot.y < top || dot.y > bottom) return []
      return [
        {
          node: at,
          x: dot.x * camera.scale + camera.x,
          y: dot.y * camera.scale + camera.y,
          pinned: at === hovered || selected.has(at),
          tag: node.kind === "tag",
          degree: node.degree,
        },
      ]
    })
    const picked = pickLabels(candidates, camera.scale > 2.1 ? 240 : 170)
    return hovered !== null && picked.includes(hovered)
      ? [...picked.filter((at) => at !== hovered), hovered]
      : picked
  }

  const tick = (now: number) => {
    frame = null
    const dt = last === 0 ? frameMs : Math.min(64, now - last)
    last = now
    let moving = false
    if (pending !== null) {
      const { scene, layout } = pending
      if (layout.step(10)) {
        pending = null
        land(scene, layout.positions())
      }
      moving = true
    }
    if (target !== null) {
      const goal = target
      camera = {
        x: approach(camera.x, goal.x, 0.18, dt),
        y: approach(camera.y, goal.y, 0.18, dt),
        scale: approach(camera.scale, goal.scale, 0.18, dt),
      }
      if (Math.abs(camera.x - goal.x) < 0.6 && Math.abs(camera.y - goal.y) < 0.6) {
        camera = goal
        target = null
      } else moving = true
    }
    const current = drawn
    if (current !== null) {
      if (morph < 1) {
        morph = Math.min(1, morph + dt / morphMs)
        const t = ease(morph)
        for (const dot of current.dots) {
          dot.x = dot.fromX + (dot.toX - dot.fromX) * t
          dot.y = dot.fromY + (dot.toY - dot.fromY) * t
        }
        if (morph === 1)
          for (const dot of current.dots) {
            dot.fromX = dot.toX
            dot.fromY = dot.toY
          }
        moving = true
      }
      const large = current.scene.nodes.length >= largeGraph
      if (current.scene.mode === "page") labelsOn = true
      else if (!labelsOn && camera.scale >= (large ? 1.32 : 1.05)) labelsOn = true
      else if (labelsOn && camera.scale <= (large ? 1.18 : 0.92)) labelsOn = false
      const selecting = selected.size > 0
      current.dots.forEach((dot, at) => {
        const node = current.scene.nodes[at]
        if (node === undefined) return
        const emphasis = selected.has(at)
          ? "selected"
          : hovered === at
            ? "hovered"
            : active.has(at)
              ? "connected"
              : selecting
                ? "dimmed"
                : "normal"
        const emphasized = emphasis !== "normal" && emphasis !== "dimmed"
        const alpha =
          visible[at] === true
            ? emphasisAlpha[emphasis] * densityAlpha(node, emphasized, camera.scale)
            : 0
        dot.alpha = approach(dot.alpha, alpha, 0.22, dt)
        dot.scale = approach(dot.scale, emphasisScale[emphasis], 0.3, dt)
        if (dot.alpha !== alpha || dot.scale !== emphasisScale[emphasis]) moving = true
      })
      const wanted = selecting || labelsOn || hovered !== null ? 1 : 0
      labelAlpha = approach(labelAlpha, wanted, 0.2, dt)
      if (labelAlpha !== wanted) moving = true
      draw(current)
    }
    if (moving) request()
    else last = 0
  }

  return {
    attach: (element: HTMLCanvasElement) => {
      canvas = element
      context = element.getContext("2d")
      const box = element.getBoundingClientRect()
      resize(box.width, box.height)
      const observer = new ResizeObserver(([entry]) => {
        if (entry !== undefined) resize(entry.contentRect.width, entry.contentRect.height)
      })
      observer.observe(element)
      element.addEventListener("pointerdown", onPointerDown)
      element.addEventListener("pointermove", onPointerMove)
      element.addEventListener("pointerup", onPointerUp)
      element.addEventListener("pointercancel", onPointerUp)
      element.addEventListener("pointerleave", onPointerLeave)
      element.addEventListener("wheel", onWheel, { passive: false })
      if (waiting !== null) {
        relayout(waiting, false)
        waiting = null
      }
      return () => {
        observer.disconnect()
        element.removeEventListener("pointerdown", onPointerDown)
        element.removeEventListener("pointermove", onPointerMove)
        element.removeEventListener("pointerup", onPointerUp)
        element.removeEventListener("pointercancel", onPointerUp)
        element.removeEventListener("pointerleave", onPointerLeave)
        element.removeEventListener("wheel", onWheel)
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
        canvas = null
        context = null
      }
    },
    setScene: (scene: Scene) => {
      if (scene === drawn?.scene || scene === pending?.scene) return
      if (canvas === null) {
        waiting = scene
        return
      }
      relayout(scene, true)
    },
    setVisibility: (next: Visibility) => {
      visibility = next
      refreshVisible()
      request()
    },
    setDepth: (next: number) => {
      if (next === depth) return
      depth = next
      refreshActive()
      request()
    },
    setLinkDistance: (next: number) => {
      if (next === linkDistance) return
      linkDistance = next
      const scene = pending?.scene ?? drawn?.scene
      if (scene !== undefined && scene.mode === "all" && canvas !== null) relayout(scene, false)
    },
    setTheme: (theme: Theme) => {
      palette = palettes[theme]
      request()
    },
    reset: () => {
      target = fit()
      hovered = null
      clearSelection()
      request()
    },
  }
}

export type GraphView = ReturnType<typeof createGraphView>
