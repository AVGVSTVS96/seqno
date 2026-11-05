import puppeteer from "puppeteer-core"
import { mkdirSync } from "node:fs"

const here = import.meta.dirname
const only = process.argv[2]
const chrome = process.env.CHROME ?? "/usr/bin/google-chrome-stable"
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--force-color-profile=srgb", "--hide-scrollbars", "--allow-file-access-from-files", "--disable-gpu", "--disable-dev-shm-usage"],
})
mkdirSync(`${here}/shots`, { recursive: true })
mkdirSync(`${here}/og`, { recursive: true })

async function shoot({ file, out, width, height, scale, scheme, fullPage }) {
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error(`${out}: ${e.message}`))
  await page.setViewport({ width, height, deviceScaleFactor: scale })
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }])
  await page.goto(`file://${here}/${file}?still`, { waitUntil: "networkidle0" })
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", { timeout: 30000 })
  await page.screenshot({ path: `${here}/${out}`, fullPage })
  await page.close()
  console.log(out)
}

const jobs = [
  ...["light", "dark"].flatMap((scheme) => [
    { name: "specimen", file: "specimen.html", out: `shots/specimen-${scheme}.png`, width: 1280, height: 900, scale: 2, scheme, fullPage: true },
    { name: "hero", file: "specimen.html", out: `shots/hero-${scheme}.png`, width: 1440, height: 900, scale: 2, scheme, fullPage: false },
  ]),
  { name: "og", file: "og/og.html", out: "og/og.png", width: 1200, height: 630, scale: 1, scheme: "light", fullPage: false },
]

for (const job of jobs.filter((j) => !only || j.name === only)) await shoot(job)
await browser.close()
