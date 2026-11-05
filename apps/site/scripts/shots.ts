import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, resolve } from "node:path"
import { chromium, type Page } from "playwright-core"

const dist = resolve(import.meta.dirname, "../dist")
const shots = resolve(import.meta.dirname, "../shots")
const only = process.argv[2]
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
}

const server = createServer((request, response) => {
  const path = join(dist, new URL(request.url ?? "/", "http://x").pathname)
  const file = existsSync(path) && statSync(path).isFile() ? path : join(dist, "index.html")
  const size = statSync(file).size
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? "")
  const headers = {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "accept-ranges": "bytes",
  }
  if (!range) {
    response.writeHead(200, { ...headers, "content-length": size })
    createReadStream(file).pipe(response)
    return
  }
  const start = Number(range[1])
  const end = range[2] ? Number(range[2]) : size - 1
  response.writeHead(206, {
    ...headers,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${size}`,
  })
  createReadStream(file, { start, end }).pipe(response)
})
await new Promise<void>((done) => server.listen(4310, "127.0.0.1", done))
const url = "http://127.0.0.1:4310/"

const browser = await chromium.launch({
  executablePath: process.env["CHROME"] ?? "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--force-color-profile=srgb", "--hide-scrollbars", "--disable-dev-shm-usage"],
})
mkdirSync(shots, { recursive: true })
const problems: Array<string> = []

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const

interface Open {
  readonly width: number
  readonly height: number
  readonly scheme: "light" | "dark"
  readonly reduced?: boolean
  readonly video?: string
  readonly github?: (page: Page) => Promise<unknown>
  readonly until?: "load" | "networkidle"
}

async function open(options: Open) {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.video ? 1 : 2,
    colorScheme: options.scheme,
    reducedMotion: options.reduced ? "reduce" : "no-preference",
    isMobile: options.width < 600,
    hasTouch: options.width < 600,
    ...(options.video
      ? {
          recordVideo: {
            dir: options.video,
            size: { width: options.width, height: options.height },
          },
        }
      : {}),
  })
  const page = await context.newPage()
  const label = `${options.width}x${options.height} ${options.scheme}${options.reduced ? " reduced" : ""}`
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      problems.push(`${label}: ${message.text()}`)
  })
  page.on("pageerror", (error) => problems.push(`${label}: ${error.message}`))
  await page.addInitScript(() => {
    const shifts = { value: 0 }
    Object.assign(globalThis, { shifts })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!("hadRecentInput" in entry) || !entry.hadRecentInput)
          shifts.value += "value" in entry ? Number(entry.value) : 0
      }
    }).observe({ type: "layout-shift", buffered: true })
  })
  await options.github?.(page)
  await page.goto(url, { waitUntil: options.until ?? "networkidle" })
  return page
}

const settled = (page: Page) =>
  page.waitForFunction(
    () => {
      const crisp = document.querySelector<HTMLElement>(".word .crisp")
      return crisp && Number(getComputedStyle(crisp).opacity) > 0.999
    },
    undefined,
    { timeout: 30_000 },
  )

async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < height; y += 300) {
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(3000)
  await page.evaluate(() => scrollTo(0, 0))
  await page.waitForTimeout(500)
}

if (!only || only === "pages") {
  for (const size of sizes) {
    for (const scheme of ["light", "dark"] as const) {
      const page = await open({ ...size, scheme })
      await settled(page)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(shots, `${size.name}-${scheme}-hero.png`) })
      const load = await page.evaluate(() => ({
        shift: Reflect.get(Reflect.get(globalThis, "shifts"), "value"),
        bytes: performance
          .getEntriesByType("resource")
          .concat(performance.getEntriesByType("navigation"))
          .reduce(
            (sum, entry) => sum + ("transferSize" in entry ? Number(entry.transferSize) : 0),
            0,
          ),
      }))
      console.log(
        `${size.name} ${scheme}: layout shift ${load.shift.toFixed(4)}, ${Math.round(load.bytes / 1024)} KB loaded before scrolling`,
      )
      await scrollThrough(page)
      await page.screenshot({
        path: join(shots, `${size.name}-${scheme}-full.png`),
        fullPage: true,
      })
      await page.context().close()
      console.log(`${size.name} ${scheme}`)
    }
  }
}

if (!only || only === "browsers") {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
  const cases = [
    ["chromium", {}, ""],
    ["other", {}, "delete Navigator.prototype.userAgentData"],
    ["ios", { userAgent: iphone }, ""],
  ] as const
  for (const [name, options, script] of cases) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      ...options,
    })
    const page = await context.newPage()
    if (script) await page.addInitScript(script)
    await page.goto(url, { waitUntil: "networkidle" })
    console.log(`${name}: ${await page.locator(".browser").innerText()}`)
    await page.locator(".actions").screenshot({ path: join(shots, `browser-${name}.png`) })
    await context.close()
  }
}

if (!only || only === "reduced") {
  const page = await open({ width: 1440, height: 900, scheme: "light", reduced: true })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(shots, "desktop-light-reduced.png") })
  await page.context().close()
  console.log("reduced motion")
}

if (!only || only === "motion") {
  const dir = join(shots, "motion")
  for (const scheme of ["light", "dark"] as const) {
    const page = await open({ width: 1440, height: 900, scheme, video: dir })
    await settled(page)
    await page.waitForTimeout(800)
    await page.mouse.move(700, 120)
    const path = Array.from(
      { length: 90 },
      (_, i) => [700 + i * 7.5, 140 + i * 3.2 + Math.sin(i / 6) * 60] as const,
    )
    for (const [x, y] of path) {
      await page.mouse.move(x, y)
      await page.waitForTimeout(16)
    }
    await page.waitForTimeout(4500)
    const video = page.video()
    await page.context().close()
    await video?.saveAs(join(dir, `hero-cursor-${scheme}.webm`))
    await video?.delete()
    console.log(`motion ${scheme}`)
  }
}

if (!only || only === "odometer") {
  const dir = join(shots, "odometer")
  mkdirSync(dir, { recursive: true })
  const baked = Number(
    /<span class="sr">Nº <!-- -->(\d+)/.exec(readFileSync(join(dist, "index.html"), "utf8"))?.[1],
  )
  const live = (page: Page) =>
    page.route("https://api.github.com/**", async (route) => {
      await new Promise((done) => setTimeout(done, 1500))
      await route.fulfill({
        headers: {
          link: `<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=${baked + 3}>; rel="last"`,
          "access-control-expose-headers": "Link",
          "access-control-allow-origin": "*",
        },
        contentType: "application/json",
        body: JSON.stringify([
          { commit: { committer: { date: new Date(Date.now() - 3 * 3_600_000).toISOString() } } },
        ]),
      })
    })
  const label = { x: 40, y: 290, width: 360, height: 60 }
  const page = await open({
    width: 1440,
    height: 900,
    scheme: "light",
    github: live,
    until: "load",
  })
  await page.waitForSelector("[data-rolled]")
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(dir, "rolled.png"), clip: label })
  await page.hover(".odo a")
  await page.waitForTimeout(400)
  await page.screenshot({
    path: join(dir, "tooltip-live.png"),
    clip: { x: 24, y: 160, width: 480, height: 200 },
  })
  console.log("live tooltip:", await page.textContent("#odo-tip"))
  await page.context().close()
  const offline = await open({
    width: 1440,
    height: 900,
    scheme: "dark",
    github: (p) => p.route("https://api.github.com/**", (r) => r.abort()),
  })
  await offline.keyboard.press("Tab")
  await offline.waitForTimeout(400)
  await offline.screenshot({
    path: join(dir, "tooltip-offline.png"),
    clip: { x: 24, y: 160, width: 480, height: 200 },
  })
  console.log("offline tooltip:", await offline.textContent("#odo-tip"))
  await offline.context().close()
  problems.push(...problems.splice(0).filter((p) => !p.includes("net::ERR_FAILED")))
}

if (!only || only === "scroll") {
  const dir = join(shots, "motion")
  for (const size of sizes) {
    const page = await open({ ...size, scheme: "light", video: dir })
    await page.waitForTimeout(1500)
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < height; y += 8) {
      await page.mouse.wheel(0, 8)
      await page.waitForTimeout(12)
      if (y % 900 === 0) await page.waitForTimeout(1600)
    }
    await page.waitForTimeout(1000)
    const video = page.video()
    await page.context().close()
    await video?.saveAs(join(dir, `scroll-${size.name}.webm`))
    await video?.delete()
    console.log(`scroll ${size.name}`)
  }
}

await browser.close()
server.close()
console.log(problems.length ? `\nconsole problems:\n${problems.join("\n")}` : "\nno console errors")
