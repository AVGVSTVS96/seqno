export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface Colors {
  readonly field: string
  readonly bullet: string
  readonly ink: string
  readonly line: number
}

interface Bullet {
  readonly hx: number
  readonly hy: number
  readonly row: number
  readonly parent: number
  readonly depth: number
  readonly bar: number
  readonly r: number
  readonly tone: "bullet" | "ink"
  x: number
  y: number
  vx: number
  vy: number
  e: number
  ta: number
  tw: number
  len: number
  reach: number
}

const GRID = 24
const TAU = Math.PI * 2
const SWIM = 34
const WAKE = 150
const FLEE = 110
const FLEE_ACCEL = 2600
const CALM = 1.4
const HOME_SPEED = 220
const GAIN = 4
const STEER = 6
const TAIL_STIFFNESS = 140
const TAIL_DAMPING = 9
const MAX_SPEED = 620
const INK_SHARE = 0.12

function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI
const smooth = (e: number) => e * e * (3 - 2 * e)
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function outlineShape(rand: () => number) {
  const rows = 3 + Math.floor(rand() * 4)
  const depths = [0]
  for (let i = 1; i < rows; i++) {
    const prev = depths[i - 1] ?? 0
    const r = rand()
    depths.push(r < 0.45 ? Math.min(prev + 1, 2) : r < 0.8 ? prev : Math.max(prev - 1, 0))
  }
  return depths.map((depth) => ({ depth, width: 3 + Math.floor(rand() * 5) }))
}

function placeOutlines(
  width: number,
  height: number,
  avoid: ReadonlyArray<Box>,
  rand: () => number,
) {
  const count = Math.min(12, Math.max(4, Math.floor((width * height) / 130_000)))
  const cols = Math.floor(width / GRID)
  const rows = Math.floor(height / GRID)
  const taken: Array<Box> = []
  const outlines: Array<{ gx: number; gy: number; shape: ReturnType<typeof outlineShape> }> = []
  for (let tries = 0; tries < 800 && outlines.length < count; tries++) {
    const shape = outlineShape(rand)
    const w = Math.max(...shape.map((r) => r.depth + r.width + 1))
    const h = shape.length
    const gx = 1 + Math.floor(rand() * Math.max(1, cols - w - 2))
    const gy = 2 + Math.floor(rand() * Math.max(1, rows - h - 3))
    const box = { x: (gx - 1) * GRID, y: (gy - 1) * GRID, w: (w + 2) * GRID, h: (h + 2) * GRID }
    if (box.x + box.w > width || box.y + box.h > height) continue
    if (taken.some((t) => overlaps(t, box)) || avoid.some((a) => overlaps(a, box))) continue
    taken.push(box)
    outlines.push({ gx, gy, shape })
  }
  return outlines
}

const flow = (x: number, y: number, t: number) =>
  (Math.sin(x * 0.0041 + t * 0.31) +
    Math.cos(y * 0.0052 - t * 0.23) +
    Math.sin((x + y) * 0.0029 + t * 0.17)) *
  Math.PI *
  0.9

const settledness = (b: Bullet) =>
  Math.max(0, 1 - Math.hypot(b.x - b.hx, b.y - b.hy) / 18) * (1 - b.e)

export function createSchool(canvas: HTMLCanvasElement, seed = 7) {
  const ctx = canvas.getContext("2d")
  const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, inside: false, moved: false }
  let colors: Colors = { field: "#F8AA6D", bullet: "#FFF8ED", ink: "#25170D", line: 0.5 }
  let width = 0
  let height = 0
  let dpr = 1
  let time = 0
  let bullets: Array<Bullet> = []

  function build(avoid: ReadonlyArray<Box>, scattered: boolean) {
    const rand = random(seed)
    const rect = canvas.getBoundingClientRect()
    width = rect.width
    height = rect.height
    dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    bullets = []
    const spread = () => 90 + rand() * 210
    for (const outline of placeOutlines(width, height, avoid, rand)) {
      const stack: Array<number> = []
      outline.shape.forEach((row, i) => {
        while (stack.length && (bullets[stack.at(-1) ?? 0]?.depth ?? 0) >= row.depth) stack.pop()
        const parent = stack.at(-1) ?? -1
        stack.push(bullets.length)
        const hx = (outline.gx + row.depth) * GRID + GRID / 2
        const hy = (outline.gy + i) * GRID + GRID / 2
        const a = rand() * TAU
        const d = spread()
        const loose = {
          x: Math.min(width - GRID, Math.max(GRID, hx + Math.cos(a) * d)),
          y: Math.min(height - GRID, Math.max(GRID, hy + Math.sin(a) * d)),
          vx: (rand() - 0.5) * 60,
          vy: (rand() - 0.5) * 60,
          e: 1,
          ta: (rand() - 0.5) * 2,
        }
        bullets.push({
          hx,
          hy,
          row: i,
          depth: row.depth,
          parent,
          bar: row.width * GRID - GRID / 2,
          ...(scattered ? loose : { x: hx, y: hy, vx: 0, vy: 0, e: 0, ta: 0 }),
          tw: 0,
          len: 0,
          reach: 0,
          r: 3 + rand() * 0.8,
          tone: rand() < INK_SHARE ? "ink" : "bullet",
        })
      })
    }
    if (!scattered) for (let i = 0; i < 90; i++) step(1 / 60)
  }

  function step(dt: number) {
    time += dt
    if (!pointer.moved) {
      pointer.vx = 0
      pointer.vy = 0
    }
    pointer.moved = false
    const moving = pointer.inside && Math.hypot(pointer.vx, pointer.vy) > 40
    const decay = Math.exp(-dt / CALM)
    for (const b of bullets) {
      const dx = b.x - pointer.x
      const dy = b.y - pointer.y
      const d = Math.hypot(dx, dy) || 1
      if (moving && d < WAKE) b.e = Math.max(b.e, 1 - (d / WAKE) * 0.4)
      b.e *= decay
      const w = smooth(b.e)
      const hx = b.hx - b.x
      const hy = b.hy - b.y
      const hd = Math.hypot(hx, hy) || 1
      const want = Math.min(HOME_SPEED, hd * GAIN)
      let ax = ((hx / hd) * want - b.vx) * STEER * (1 - w)
      let ay = ((hy / hd) * want - b.vy) * STEER * (1 - w)
      if (w > 0.001) {
        const angle = flow(b.x, b.y, time)
        let tx = Math.cos(angle) * SWIM
        let ty = Math.sin(angle) * SWIM
        let n = 0
        let avx = 0
        let avy = 0
        let sx = 0
        let sy = 0
        for (const q of bullets) {
          if (q === b || q.e < 0.2) continue
          const qx = q.x - b.x
          const qy = q.y - b.y
          const dd = qx * qx + qy * qy
          if (dd > 3136) continue
          n++
          avx += q.vx
          avy += q.vy
          if (dd < 196) {
            sx -= qx / (dd + 1)
            sy -= qy / (dd + 1)
          }
        }
        if (n) {
          tx = tx * 0.6 + (avx / n) * 0.4
          ty = ty * 0.6 + (avy / n) * 0.4
        }
        ax += ((tx - b.vx) * 1.8 + sx * 900) * w
        ay += ((ty - b.vy) * 1.8 + sy * 900) * w
        const m = 2 * GRID
        if (b.x < m) ax += (m - b.x) * 6 * w
        if (b.x > width - m) ax -= (b.x - width + m) * 6 * w
        if (b.y < m) ay += (m - b.y) * 6 * w
        if (b.y > height - m) ay -= (b.y - height + m) * 6 * w
      }
      if (moving && d < FLEE) {
        const f = FLEE_ACCEL * (1 - d / FLEE) ** 2
        ax += (dx / d) * f
        ay += (dy / d) * f
      }
      b.vx += ax * dt
      b.vy += ay * dt
      const speed = Math.hypot(b.vx, b.vy)
      if (speed > MAX_SPEED) {
        b.vx *= MAX_SPEED / speed
        b.vy *= MAX_SPEED / speed
      }
      b.x += b.vx * dt
      b.y += b.vy * dt
      const target = Math.atan2(-b.vx, 70 - b.vy)
      b.tw += (TAIL_STIFFNESS * wrap(target - b.ta) - TAIL_DAMPING * b.tw) * dt
      b.ta = wrap(b.ta + b.tw * dt)
    }
    for (const b of bullets) {
      if (settledness(b) <= 0.6) continue
      for (let p = b.parent; p >= 0;) {
        const up = bullets[p]
        if (!up) break
        up.reach = Math.max(up.reach, b.row - up.row)
        p = up.parent
      }
    }
    let restless = false
    for (const b of bullets) {
      const s = settledness(b)
      const loose = 12 + Math.min(12, Math.hypot(b.vx, b.vy) * 0.04)
      const guide = b.reach ? b.reach * GRID + 8 : 0
      const len = loose * (1 - s) + guide * s
      b.len += (len - b.len) * (1 - Math.exp(-dt * 9))
      b.reach = 0
      restless ||=
        b.e > 0.002 ||
        Math.abs(b.vx) + Math.abs(b.vy) > 0.5 ||
        Math.abs(b.x - b.hx) + Math.abs(b.y - b.hy) > 0.05 ||
        Math.abs(b.tw) > 0.01 ||
        Math.abs(len - b.len) > 0.05
    }
    return !restless
  }

  function draw() {
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.lineCap = "round"
    for (const b of bullets) {
      const s = settledness(b)
      const tone = colors[b.tone]
      if (s > 0.01) {
        const bw = b.bar * Math.min(1, s * 1.15)
        ctx.globalAlpha = s
        ctx.fillStyle = colors.field
        ctx.fillRect(b.x + 9, b.y - 3.5, bw + 4, 7)
        ctx.globalAlpha = colors.line * s
        ctx.fillStyle = tone
        ctx.beginPath()
        ctx.roundRect(b.x + 11, b.y - 1.5, bw, 3, 1.5)
        ctx.fill()
      }
      const from = b.r + 3.5
      if (b.len > from + 1) {
        const ux = Math.sin(b.ta)
        const uy = Math.cos(b.ta)
        ctx.globalAlpha = colors.line * 1.1
        ctx.strokeStyle = tone
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(b.x + ux * from, b.y + uy * from)
        ctx.lineTo(b.x + ux * b.len, b.y + uy * b.len)
        ctx.stroke()
      }
      const stretch = 1 + Math.min(0.45, Math.hypot(b.vx, b.vy) / 900)
      ctx.globalAlpha = b.tone === "ink" ? 0.92 : 0.96
      ctx.fillStyle = tone
      ctx.beginPath()
      ctx.ellipse(b.x, b.y, b.r * stretch, b.r / Math.sqrt(stretch), Math.atan2(b.vy, b.vx), 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function order() {
    if (!bullets.length) return 1
    let sum = 0
    for (const b of bullets) sum += settledness(b)
    return sum / bullets.length
  }

  function move(x: number, y: number, vx: number, vy: number) {
    Object.assign(pointer, { x, y, vx, vy, inside: true, moved: true })
  }

  return {
    build,
    step,
    draw,
    order,
    move,
    leave: () => void (pointer.inside = false),
    paint(next: Colors) {
      colors = next
      draw()
    },
  }
}

export type School = ReturnType<typeof createSchool>

interface RunOptions {
  readonly avoid: () => ReadonlyArray<Box>
  readonly colors: () => Colors
  readonly onFrame: (order: number) => void
  readonly still: boolean
}

export function run(canvas: HTMLCanvasElement, element: HTMLElement, options: RunOptions) {
  const school = createSchool(canvas)
  const scheme = matchMedia("(prefers-color-scheme: dark)")
  let frame = 0
  let last = 0
  let previous: { x: number; y: number; t: number } | null = null

  const tick = (now: number) => {
    const rested = school.step(Math.min((now - (last || now)) / 1000, 1 / 30))
    last = now
    school.draw()
    options.onFrame(school.order())
    frame = rested ? 0 : requestAnimationFrame(tick)
  }
  const wake = () => {
    if (frame || document.hidden || options.still) return
    last = 0
    frame = requestAnimationFrame(tick)
  }
  const sleep = () => {
    cancelAnimationFrame(frame)
    frame = 0
  }
  const onMove = (event: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    const x = event.clientX - r.left
    const y = event.clientY - r.top
    const dt = previous ? Math.max((event.timeStamp - previous.t) / 1000, 1 / 240) : 1
    school.move(x, y, previous ? (x - previous.x) / dt : 0, previous ? (y - previous.y) / dt : 0)
    previous = { x, y, t: event.timeStamp }
    wake()
  }
  const onLeave = () => {
    school.leave()
    previous = null
  }
  const onVisibility = () => (document.hidden ? sleep() : wake())
  const onScheme = () => school.paint(options.colors())

  school.paint(options.colors())
  school.build(options.avoid(), !options.still)
  options.onFrame(school.order())
  school.draw()
  wake()

  let observed = false
  const resize = new ResizeObserver(() => {
    if (observed) {
      school.build(options.avoid(), false)
      school.draw()
      options.onFrame(school.order())
    }
    observed = true
  })
  resize.observe(canvas)
  element.addEventListener("pointermove", onMove)
  element.addEventListener("pointerleave", onLeave)
  document.addEventListener("visibilitychange", onVisibility)
  scheme.addEventListener("change", onScheme)

  return () => {
    sleep()
    resize.disconnect()
    element.removeEventListener("pointermove", onMove)
    element.removeEventListener("pointerleave", onLeave)
    document.removeEventListener("visibilitychange", onVisibility)
    scheme.removeEventListener("change", onScheme)
  }
}
