import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, type Locator } from "playwright-core"
import { encode, media } from "./encode.ts"

const seqno = resolve(process.env["SEQNO_REPO"] ?? join(import.meta.dirname, "../../../seqno"))
const app = process.env["SEQNO_APP"] ?? "http://127.0.0.1:4300"
const [scene = "outline", theme = "light"] = process.argv.slice(2)
const still = scene === "links"
const view = still ? { width: 1440, height: 1000 } : { width: 760, height: 532 }
const below = still ? 0 : 56
const scale = 2
const flags = (line: string) => line.split(" ")

const { materializeShowcase } = await import(join(seqno, "tools/e2e/design/showcase.ts"))
const { editBlock, openSeqno, scrollToText } = await import(
  join(seqno, "tools/e2e/design/seqno.ts")
)
const { seedOpfs } = await import(join(seqno, "tools/e2e/src/opfs.ts"))

const cursor = `
addEventListener("DOMContentLoaded", () => {
  const arrow = document.createElement("div")
  arrow.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M4 2.5v15.2l4-3.9 2.6 6 2.7-1.2-2.6-5.9h5.6z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  Object.assign(arrow.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transformOrigin: "4px 2px", translate: "-100px -100px" })
  document.body.append(arrow)
  const place = (event) => { arrow.style.translate = (event.clientX - 4) + "px " + (event.clientY - 2) + "px" }
  for (const type of ["mousemove", "dragover", "drag"]) addEventListener(type, place, true)
  addEventListener("mousedown", () => { arrow.style.scale = "0.88" }, true)
  addEventListener("mouseup", () => { arrow.style.scale = "1" }, true)
  addEventListener("dragend", () => { arrow.style.scale = "1" }, true)
  document.addEventListener("mouseout", (event) => { if (!event.relatedTarget) arrow.style.translate = "-100px -100px" })
})`

const browser = await chromium.launch({
  executablePath: process.env["CHROME"] ?? "/usr/bin/google-chrome-stable",
  headless: true,
  args: [
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--disable-dev-shm-usage",
    `--force-device-scale-factor=${scale}`,
  ],
})
const context = await browser.newContext({
  baseURL: app,
  viewport: { width: view.width, height: view.height + below },
  deviceScaleFactor: scale,
})
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const showcase = await materializeShowcase(new Date())
await seedOpfs(page, showcase, ["graphs", "demo"])
await rm(showcase, { recursive: true })
await page.evaluate(
  ({ chosen, sidebar }) => {
    localStorage.setItem("seqno.theme", JSON.stringify(chosen))
    localStorage.setItem("seqno.leftSidebar", JSON.stringify(sidebar))
  },
  { chosen: theme, sidebar: still },
)
if (!still) await page.addInitScript(cursor)

let pointer = { x: view.width + 40, y: view.height - 60 }
const wait = (ms: number) => page.waitForTimeout(ms)
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

async function glide(x: number, y: number, ms = 650) {
  const from = pointer
  const start = performance.now()
  for (let done = 0; done < 1;) {
    done = Math.min(1, (performance.now() - start) / ms)
    const t = ease(done)
    await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t)
    await wait(8)
  }
  pointer = { x, y }
}

async function point(locator: Locator, at: "start" | "end" | "center" | "top" = "center") {
  const box = await locator.boundingBox()
  if (!box) throw new Error("nothing to point at")
  const x =
    at === "end" ? box.x + box.width - 2 : at === "start" ? box.x + 4 : box.x + box.width / 2
  const y = at === "top" ? box.y + 5 : box.y + box.height / 2
  return { x, y }
}

const ownRow = (text: string) =>
  page
    .locator('[role="treeitem"]')
    .filter({ has: page.getByText(text, { exact: true }) })
    .last()

async function outline() {
  await openSeqno(page, "/page/showcase")
  await scrollToText(page, "Structure", 16)
  return async () => {
    await wait(900)
    const five = page.getByText("Five levels of nesting", { exact: true })
    const end = await point(five, "end")
    await glide(end.x + 3, end.y)
    await page.mouse.click(end.x + 3, end.y)
    await wait(450)
    await page.keyboard.press("Tab")
    await wait(1000)
    await page.keyboard.press("Shift+Tab")
    await wait(800)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await wait(400)

    const bulletOf = (text: string) =>
      point(ownRow(text).getByRole("button", { name: "Zoom into block" }).first())
    const third = await bulletOf("Cover with a clear lid until they sprout")
    await glide(third.x, third.y)
    await page.mouse.down()
    const second = await point(
      page.getByText("Press two seeds into each cell", { exact: true }),
      "top",
    )
    await glide(third.x + 6, second.y - 2, 700)
    await page.mouse.up()
    await wait(900)
    const back = await bulletOf("Press two seeds into each cell")
    await glide(back.x, back.y, 400)
    await page.mouse.down()
    const target = await point(
      page.getByText("Cover with a clear lid until they sprout", { exact: true }),
      "top",
    )
    await glide(back.x + 6, target.y - 2, 700)
    await page.mouse.up()
    await wait(800)

    const text = await point(five, "start")
    await glide(text.x + 40, text.y, 450)
    const fold = await point(
      ownRow("Five levels of nesting").getByRole("button", { name: "Collapse" }).first(),
    )
    await glide(fold.x, fold.y, 350)
    await page.mouse.click(fold.x, fold.y)
    await wait(1000)
    await page.mouse.click(fold.x, fold.y)
    await wait(800)

    const bullet = await bulletOf("Five levels of nesting")
    await glide(bullet.x, bullet.y, 350)
    await page.mouse.click(bullet.x, bullet.y)
    await wait(1500)
    const leaving = glide(view.width + 40, view.height - 60, 900)
    await wait(250)
    await page.goBack()
    await leaving
    await wait(1000)
  }
}

async function queries() {
  await openSeqno(page, "/page/showcase")
  await scrollToText(page, "Renew the allotment lease", 16)
  await page
    .getByRole("region", { name: "Live query" })
    .first()
    .getByRole("region")
    .first()
    .waitFor()
  return async () => {
    await wait(900)
    const task = page.getByText("Renew the allotment lease", { exact: true })
    const end = await point(task, "end")
    await glide(end.x + 4, end.y)
    await page.mouse.click(end.x + 4, end.y)
    await wait(500)
    await page.keyboard.press("Home")
    await page.keyboard.press("Shift+Control+ArrowRight")
    await wait(300)
    await page.keyboard.type("DOING", { delay: 110 })
    await wait(1600)
    await page.keyboard.press("Home")
    await page.keyboard.press("Shift+Control+ArrowRight")
    await wait(300)
    await page.keyboard.type("TODO", { delay: 110 })
    await wait(1200)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await wait(300)
    await glide(view.width + 40, view.height - 60, 700)
    await wait(900)
  }
}

async function crop(name: string, clip: { x: number; y: number; width: number; height: number }) {
  await page.mouse.move(view.width - 4, view.height - 4)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"))
  const png = join(tmpdir(), `${name}.png`)
  await page.screenshot({ path: png, clip })
  encode(png, name, [clip.width, clip.width * scale])
  rmSync(png)
}

async function links() {
  await openSeqno(page, "/")
  await page
    .getByRole("link", { name: /Garden Plan/ })
    .first()
    .click({ modifiers: ["Shift"] })
  await page.getByRole("complementary", { name: "Right sidebar" }).waitFor()
  await crop(`references-${theme}`, { x: 870, y: 466, width: 564, height: 404 })
  await page.getByRole("button", { name: "Toggle right sidebar" }).click()
  await editBlock(page, "The seedlings have their first true leaves")
  await page.keyboard.type(" [[Gar")
  await page.getByRole("listbox").getByRole("option").first().waitFor()
  await crop(`typing-${theme}`, { x: 334, y: 182, width: 600, height: 204 })
}

if (still) {
  await links()
  await browser.close()
  process.exit()
}

const play = await { outline, queries }[scene === "queries" ? "queries" : "outline"]()
await page.mouse.move(pointer.x, pointer.y)
await wait(600)

const frames = join(tmpdir(), `seqno-${scene}-${theme}`)
rmSync(frames, { recursive: true, force: true })
mkdirSync(frames, { recursive: true })
const stamps: Array<{ file: string; time: number }> = []
const cdp = await context.newCDPSession(page)
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = join(frames, `${String(stamps.length).padStart(5, "0")}.jpg`)
  writeFileSync(file, Buffer.from(data, "base64"))
  stamps.push({ file, time: metadata.timestamp ?? 0 })
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
})
await cdp.send("Page.startScreencast", {
  format: "jpeg",
  quality: 94,
  maxWidth: view.width * scale,
  maxHeight: (view.height + below) * scale,
  everyNthFrame: 1,
})
await wait(400)
await play()
const stopped = Date.now() / 1000
await cdp.send("Page.stopScreencast")
const list = stamps
  .map(
    (s, i) =>
      `file '${s.file}'\nduration ${((stamps[i + 1]?.time ?? stopped) - s.time).toFixed(4)}`,
  )
  .join("\n")
writeFileSync(join(frames, "list.txt"), `${list}\nfile '${stamps.at(-1)?.file}'\n`)
const filter = [
  `crop=${view.width * scale}:${view.height * scale}:0:0`,
  "scale=1200:-2:flags=lanczos:out_color_matrix=bt709:out_range=tv",
  "format=yuv420p",
  "fps=60",
].join(",")
const input = [
  ...flags("-loglevel error -y -f concat -safe 0 -i"),
  join(frames, "list.txt"),
  "-vf",
  filter,
  ...flags("-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -an"),
]
execFileSync("ffmpeg", [
  ...input,
  ...flags("-c:v libsvtav1 -preset 4 -crf 30 -g 600"),
  join(media, `${scene}-${theme}.webm`),
])
execFileSync("ffmpeg", [
  ...input,
  ...flags("-c:v libx264 -preset veryslow -crf 21 -tune animation -profile:v high"),
  ...flags("-movflags +faststart"),
  join(media, `${scene}-${theme}.mp4`),
])
rmSync(frames, { recursive: true })
console.log(
  `${scene}-${theme}: ${stamps.length} frames, ${(stopped - (stamps[0]?.time ?? stopped)).toFixed(1)}s`,
)

await browser.close()
