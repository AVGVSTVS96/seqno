;(() => {
  const GRID = 24
  const TAU = Math.PI * 2

  const defaults = {
    seed: 7,
    count: 9,
    avoid: [],
    colors: { field: "#F8AA6D", bullet: "#FFF8ED", ink: "#25170D", line: 0.5 },
    inkShare: 0.12,
    spread: [90, 300],
    swim: 34,
    wake: 150,
    flee: 110,
    fleeAccel: 2600,
    calm: 1.4,
    homeSpeed: 220,
    gain: 4,
    steer: 6,
    tailStiffness: 140,
    tailDamping: 9,
    reduced: false,
  }

  function random(seed) {
    let s = seed >>> 0
    return () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI
  const smooth = (e) => e * e * (3 - 2 * e)
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  function outlineShape(rand) {
    const rows = 3 + Math.floor(rand() * 4)
    const depths = [0]
    for (let i = 1; i < rows; i++) {
      const prev = depths[i - 1]
      const r = rand()
      depths.push(r < 0.45 ? Math.min(prev + 1, 2) : r < 0.8 ? prev : Math.max(prev - 1, 0))
    }
    return depths.map((depth) => ({ depth, width: 3 + Math.floor(rand() * 5) }))
  }

  function placeOutlines({ width, height, avoid, rand, count }) {
    const cols = Math.floor(width / GRID)
    const rows = Math.floor(height / GRID)
    const taken = []
    const outlines = []
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

  function createSchool(canvas, options = {}) {
    const o = { ...defaults, ...options, colors: { ...defaults.colors, ...options.colors } }
    const ctx = canvas.getContext("2d")
    const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, inside: false, moved: false }
    let width = 0
    let height = 0
    let dpr = 1
    let time = 0
    let bullets = []

    function scatter(rand, hx, hy) {
      const a = rand() * TAU
      const r = o.spread[0] + rand() * (o.spread[1] - o.spread[0])
      return {
        x: Math.min(width - GRID, Math.max(GRID, hx + Math.cos(a) * r)),
        y: Math.min(height - GRID, Math.max(GRID, hy + Math.sin(a) * r)),
      }
    }

    function build(scattered = !o.reduced) {
      const rand = random(o.seed)
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      bullets = []
      for (const outline of placeOutlines({ width, height, avoid: o.avoid, rand, count: o.count })) {
        const stack = []
        outline.shape.forEach((row, i) => {
          while (stack.length && bullets[stack[stack.length - 1]].depth >= row.depth) stack.pop()
          const parent = stack.length ? stack[stack.length - 1] : -1
          stack.push(bullets.length)
          const hx = (outline.gx + row.depth) * GRID + GRID / 2
          const hy = (outline.gy + i) * GRID + GRID / 2
          const loose = { ...scatter(rand, hx, hy), vx: (rand() - 0.5) * 60, vy: (rand() - 0.5) * 60, e: 1, ta: (rand() - 0.5) * 2 }
          bullets.push({
            hx, hy, row: i, depth: row.depth, parent,
            bar: row.width * GRID - GRID / 2,
            ...(scattered ? loose : { x: hx, y: hy, vx: 0, vy: 0, e: 0, ta: 0 }),
            tw: 0,
            len: 0,
            reach: 0,
            r: 3 + rand() * 0.8,
            tone: rand() < o.inkShare ? "ink" : "bullet",
          })
        })
      }
      if (!scattered) for (let i = 0; i < 90; i++) step(1 / 60)
    }

    function flow(x, y, t) {
      return (Math.sin(x * 0.0041 + t * 0.31) + Math.cos(y * 0.0052 - t * 0.23) + Math.sin((x + y) * 0.0029 + t * 0.17)) * Math.PI * 0.9
    }

    function settledness(b) {
      return Math.max(0, 1 - Math.hypot(b.x - b.hx, b.y - b.hy) / 18) * (1 - b.e)
    }

    function step(dt) {
      time += dt
      if (!pointer.moved) { pointer.vx = 0; pointer.vy = 0 }
      pointer.moved = false
      const moving = pointer.inside && Math.hypot(pointer.vx, pointer.vy) > 40
      const decay = Math.exp(-dt / o.calm)
      for (const b of bullets) {
        const dx = b.x - pointer.x
        const dy = b.y - pointer.y
        const d = Math.hypot(dx, dy) || 1
        if (moving && !o.reduced && d < o.wake) b.e = Math.max(b.e, 1 - (d / o.wake) * 0.4)
        b.e *= decay
        const w = smooth(b.e)
        const hx = b.hx - b.x
        const hy = b.hy - b.y
        const hd = Math.hypot(hx, hy) || 1
        const want = Math.min(o.homeSpeed, hd * o.gain)
        let ax = ((hx / hd) * want - b.vx) * o.steer * (1 - w)
        let ay = ((hy / hd) * want - b.vy) * o.steer * (1 - w)
        if (w > 0.001) {
          const angle = flow(b.x, b.y, time)
          let tx = Math.cos(angle) * o.swim
          let ty = Math.sin(angle) * o.swim
          let n = 0, avx = 0, avy = 0, sx = 0, sy = 0
          for (const q of bullets) {
            if (q === b || q.e < 0.2) continue
            const qx = q.x - b.x
            const qy = q.y - b.y
            const dd = qx * qx + qy * qy
            if (dd > 3136) continue
            n++
            avx += q.vx
            avy += q.vy
            if (dd < 196) { sx -= qx / (dd + 1); sy -= qy / (dd + 1) }
          }
          if (n) { tx = tx * 0.6 + (avx / n) * 0.4; ty = ty * 0.6 + (avy / n) * 0.4 }
          ax += ((tx - b.vx) * 1.8 + sx * 900) * w
          ay += ((ty - b.vy) * 1.8 + sy * 900) * w
          const m = 2 * GRID
          if (b.x < m) ax += (m - b.x) * 6 * w
          if (b.x > width - m) ax -= (b.x - width + m) * 6 * w
          if (b.y < m) ay += (m - b.y) * 6 * w
          if (b.y > height - m) ay -= (b.y - height + m) * 6 * w
        }
        if (moving && d < o.flee) {
          const f = o.fleeAccel * (1 - d / o.flee) ** 2
          ax += (dx / d) * f
          ay += (dy / d) * f
        }
        b.vx += ax * dt
        b.vy += ay * dt
        const speed = Math.hypot(b.vx, b.vy)
        if (speed > 620) { b.vx *= 620 / speed; b.vy *= 620 / speed }
        b.x += b.vx * dt
        b.y += b.vy * dt
        const target = Math.atan2(-b.vx, 70 - b.vy)
        b.tw += (o.tailStiffness * wrap(target - b.ta) - o.tailDamping * b.tw) * dt
        b.ta = wrap(b.ta + b.tw * dt)
      }
      for (const b of bullets) {
        if (settledness(b) <= 0.6) continue
        for (let p = b.parent; p >= 0; p = bullets[p].parent) bullets[p].reach = Math.max(bullets[p].reach, b.row - bullets[p].row)
      }
      for (const b of bullets) {
        const s = settledness(b)
        const loose = 12 + Math.min(12, Math.hypot(b.vx, b.vy) * 0.04)
        const guide = b.reach ? b.reach * GRID + 8 : 0
        b.len += (loose * (1 - s) + guide * s - b.len) * (1 - Math.exp(-dt * 9))
        b.reach = 0
      }
    }

    function draw() {
      const c = o.colors
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.lineCap = "round"
      for (const b of bullets) {
        const s = settledness(b)
        const tone = c[b.tone]
        if (s > 0.01) {
          const bw = b.bar * Math.min(1, s * 1.15)
          ctx.globalAlpha = s
          ctx.fillStyle = c.field
          ctx.fillRect(b.x + 9, b.y - 3.5, bw + 4, 7)
          ctx.globalAlpha = c.line * s
          ctx.fillStyle = tone
          ctx.beginPath()
          ctx.roundRect(b.x + 11, b.y - 1.5, bw, 3, 1.5)
          ctx.fill()
        }
        const from = b.r + 3.5
        if (b.len > from + 1) {
          const ux = Math.sin(b.ta)
          const uy = Math.cos(b.ta)
          ctx.globalAlpha = c.line * 1.1
          ctx.strokeStyle = tone
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(b.x + ux * from, b.y + uy * from)
          ctx.lineTo(b.x + ux * b.len, b.y + uy * b.len)
          ctx.stroke()
        }
        const speed = Math.hypot(b.vx, b.vy)
        const stretch = 1 + Math.min(0.45, speed / 900)
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

    function move(x, y, vx, vy) {
      pointer.x = x
      pointer.y = y
      pointer.vx = vx
      pointer.vy = vy
      pointer.inside = true
      pointer.moved = true
    }

    function run(element, onFrame = () => {}) {
      let frame = 0
      let last = 0
      let previous = null
      const tick = (now) => {
        step(Math.min((now - (last || now)) / 1000, 1 / 30))
        last = now
        draw()
        onFrame(order())
        frame = requestAnimationFrame(tick)
      }
      const onMove = (e) => {
        const r = canvas.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        const dt = previous ? Math.max((e.timeStamp - previous.t) / 1000, 1 / 240) : 1
        move(x, y, previous ? (x - previous.x) / dt : 0, previous ? (y - previous.y) / dt : 0)
        previous = { x, y, t: e.timeStamp }
      }
      const onLeave = () => { pointer.inside = false; previous = null }
      const onVisibility = () => {
        cancelAnimationFrame(frame)
        last = 0
        if (!document.hidden) frame = requestAnimationFrame(tick)
      }
      let observed = false
      const resize = new ResizeObserver(() => {
        if (observed) build(false)
        observed = true
      })
      element.addEventListener("pointermove", onMove)
      element.addEventListener("pointerleave", onLeave)
      document.addEventListener("visibilitychange", onVisibility)
      resize.observe(canvas)
      frame = requestAnimationFrame(tick)
      return () => {
        cancelAnimationFrame(frame)
        element.removeEventListener("pointermove", onMove)
        element.removeEventListener("pointerleave", onLeave)
        document.removeEventListener("visibilitychange", onVisibility)
        resize.disconnect()
      }
    }

    build()
    return {
      run, step, draw, order, move,
      leave: () => { pointer.inside = false },
      advance(seconds, fps = 60) {
        for (let i = 0; i < Math.round(seconds * fps); i++) step(1 / fps)
        draw()
        return order()
      },
      stroke(points, fps = 60) {
        for (let i = 1; i < points.length; i++) {
          const [x0, y0] = points[i - 1]
          const [x1, y1] = points[i]
          move(x1, y1, (x1 - x0) * fps, (y1 - y0) * fps)
          step(1 / fps)
        }
        draw()
        return order()
      },
    }
  }

  globalThis.createSchool = createSchool
})()
