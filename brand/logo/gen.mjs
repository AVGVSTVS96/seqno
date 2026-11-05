import opentype from "opentype.js"
import { writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const here = import.meta.dirname
const font = opentype.loadSync(`${here}/src/wix-madefor-display-800.woff`)

const color = {
  ink: "#25170D",
  field: "#F8AA6D",
  paper: "#FDF9F4",
  night: "#F1EAE3",
}

const XH = 526
const TRACK = -36
const ORD = { size: 276, bar: 82, gap: 14 }

const num = (n) => +n.toFixed(1)

function pathData(commands) {
  return commands.map((c) => {
    if (c.type === "M" || c.type === "L") return `${c.type}${num(c.x)} ${num(c.y)}`
    if (c.type === "Q") return `Q${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`
    if (c.type === "C") return `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`
    return "Z"
  }).join("")
}

const circle = (cx, cy, r) => `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`
const rect = (x, y, w, h) => `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`
const pill = (x, y, w, h) => {
  const r = Math.min(w, h) / 2
  return `M${num(x + r)} ${num(y)}h${num(w - 2 * r)}a${num(r)} ${num(r)} 0 0 1 ${num(r)} ${num(r)}v${num(h - 2 * r)}a${num(r)} ${num(r)} 0 0 1 ${num(-r)} ${num(r)}h${num(2 * r - w)}a${num(r)} ${num(r)} 0 0 1 ${num(-r)} ${num(-r)}v${num(2 * r - h)}a${num(r)} ${num(r)} 0 0 1 ${num(r)} ${num(-r)}Z`
}

function squircle(size, inset = 0, exponent = 5) {
  const a = size / 2 - inset
  const points = Array.from({ length: 160 }, (_, i) => {
    const t = (i / 160) * Math.PI * 2
    const x = Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** (2 / exponent)
    const y = Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** (2 / exponent)
    return `${num(size / 2 + a * x)} ${num(size / 2 + a * y)}`
  })
  return `M${points.join("L")}Z`
}

function set(text) {
  let x = 0
  const parts = []
  for (const ch of text) {
    const glyph = font.charToGlyph(ch)
    parts.push(pathData(glyph.getPath(x, 0, 1000).commands))
    x += glyph.advanceWidth + TRACK
  }
  return { d: parts.join(""), end: x - TRACK }
}

function ordinal(x) {
  const r = ORD.size / 2
  return circle(x + r, -XH + r, r) + rect(x, -ORD.bar, ORD.size, ORD.bar)
}

function numero(text) {
  const base = set(text)
  const x = base.end + ORD.gap
  const left = font.charToGlyph(text[0]).leftSideBearing
  return { d: base.d + ordinal(x), box: { x: left, y: -XH, w: x + ORD.size - left, h: XH } }
}

const wordmark = (() => {
  const w = numero("seqn")
  return { d: w.d, box: { ...w.box, h: XH + 194 } }
})()
const mark = numero("n")

function placed(shape, size, width) {
  const s = width / shape.box.w
  const tx = (size - shape.box.w * s) / 2 - shape.box.x * s
  const ty = (size - shape.box.h * s) / 2 - shape.box.y * s
  return `<path transform="translate(${num(tx)} ${num(ty)}) scale(${+s.toFixed(5)})" d="${shape.d}"/>`
}

function tile({ size = 1024, fill = color.field, ink = color.ink, bleed = false, width = 0.62, knockout = false }) {
  const bg = bleed ? rect(0, 0, size, size) : squircle(size)
  if (knockout) {
    return `<mask id="seqno-knockout"><path fill="#fff" d="${bg}"/><g fill="#000">${placed(mark, size, size * width)}</g></mask><path mask="url(#seqno-knockout)" d="${bg}"/>`
  }
  return `<path fill="${fill}" d="${bg}"/><g fill="${ink}">${placed(mark, size, size * width)}</g>`
}

const svg = (box, body, fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(num).join(" ")}"${fill ? ` fill="${fill}"` : ""}>${body}</svg>\n`

const box = (b) => [b.x, b.y, b.w, b.h]

function lockup({ tileFill, tileInk, word, knockout = false }) {
  const t = 700
  const gap = 150
  const ty = -XH + (XH - t) / 2 + 40
  const tileSvg = knockout
    ? tile({ size: t, knockout: true })
    : tile({ size: t, fill: tileFill, ink: tileInk })
  const body = `<g transform="translate(${wordmark.box.x - t - gap} ${ty})">${tileSvg}</g><path${word ? ` fill="${word}"` : ""} d="${wordmark.d}"/>`
  const x = wordmark.box.x - t - gap
  return svg([x, Math.min(ty, -XH), wordmark.box.x + wordmark.box.w - x, Math.max(ty + t, 194) - Math.min(ty, -XH)], body, knockout ? "currentColor" : undefined)
}

const files = {
  "wordmark.svg": svg(box(wordmark.box), `<path d="${wordmark.d}"/>`, color.ink),
  "wordmark-dark.svg": svg(box(wordmark.box), `<path d="${wordmark.d}"/>`, color.night),
  "wordmark-mono.svg": svg(box(wordmark.box), `<path d="${wordmark.d}"/>`, "currentColor"),
  "mark.svg": svg(box(mark.box), `<path d="${mark.d}"/>`, color.ink),
  "mark-dark.svg": svg(box(mark.box), `<path d="${mark.d}"/>`, color.night),
  "mark-mono.svg": svg(box(mark.box), `<path d="${mark.d}"/>`, "currentColor"),
  "app-icon.svg": svg([0, 0, 1024, 1024], tile({})),
  "app-icon-mono.svg": svg([0, 0, 1024, 1024], tile({ knockout: true }), "currentColor"),
  "lockup.svg": lockup({ tileFill: color.field, tileInk: color.ink, word: color.ink }),
  "lockup-dark.svg": lockup({ tileFill: color.field, tileInk: color.ink, word: color.night }),
  "lockup-mono.svg": lockup({ knockout: true }),
  "favicon.svg": svg([0, 0, 64, 64], tile({ size: 64, width: 0.74 })),
}

const explore = (() => {
  const card = (markSvg, wordSvg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 640"><rect width="1600" height="640" fill="${color.paper}"/><g fill="${color.ink}">${markSvg}${wordSvg}</g></svg>\n`
  const plain = set("seqno")
  const word = (d) => `<path transform="translate(600 392) scale(0.33)" d="${d}"/>`

  const r = 5.2, line = 2.4, row = 13, indent = 14, px = 9, py = 9
  const bar = (x, y, w) => pill(x + r + 3.6, y - line / 2, w, line)
  const outline = [
    circle(px, py, r), bar(px, py, 22),
    pill(px - line / 2, py + r + 3.2, line, row * 2 - r - 1.4),
    circle(px + indent, py + row, r), bar(px + indent, py + row, 12),
    circle(px + indent, py + row * 2, r), bar(px + indent, py + row * 2, 17),
  ].join("")

  let x = 0
  const parts = []
  let q = ""
  for (const ch of "seqno") {
    if (ch === "q") {
      const d = XH + 8, stem = 150, gap = 30, cx = x + 35 + d / 2
      parts.push(circle(cx, -XH / 2 - 2, d / 2) + rect(cx + d / 2 + gap, -XH + 30, stem, XH + 164))
      q = circle(d / 2, -XH / 2 - 2, d / 2) + rect(d + gap, -XH + 30, stem, XH + 164)
      x = cx + d / 2 + gap + stem + 24
      continue
    }
    const glyph = font.charToGlyph(ch)
    parts.push(pathData(glyph.getPath(x, 0, 1000).commands))
    x += glyph.advanceWidth - 40
  }

  return {
    "explore-a-outline.svg": card(`<path transform="translate(150 196) scale(6)" d="${outline}"/>`, word(plain.d)),
    "explore-b-bullet-q.svg": card(`<path transform="translate(150 392) scale(0.33)" d="${q}"/>`, word(parts.join(""))),
    "explore-c-numero.svg": card(`<path transform="translate(120 392) scale(0.33)" d="${mark.d}"/>`, word(wordmark.d)),
  }
})()

for (const [name, body] of Object.entries({ ...files, ...explore })) writeFileSync(`${here}/${name}`, body)

writeFileSync(`${here}/.apple.svg`, svg([0, 0, 180, 180], tile({ size: 180, bleed: true, width: 0.6 })))
const png = (src, out, size) => {
  const r = spawnSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", `${here}/${out}`, `${here}/${src}`])
  if (r.status !== 0) throw new Error(r.stderr.toString())
}
png("favicon.svg", "favicon-32.png", 32)
png("app-icon.svg", "icon-512.png", 512)
png(".apple.svg", "apple-touch-icon.png", 180)
spawnSync("rm", [`${here}/.apple.svg`])

console.log(Object.keys({ ...files, ...explore }).join("\n"), "\nfavicon-32.png\nicon-512.png\napple-touch-icon.png")
