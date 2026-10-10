import type { Locator, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const openShowcaseAt = async (page: Page, path: string) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await openDemo(page, path)
}

const graphCanvas = (page: Page) => page.getByRole("application", { name: "Graph canvas" })

const nodeCount = async (page: Page) => {
  const text = await page
    .getByRole("region", { name: "Graph settings" })
    .getByText(/ nodes?$/)
    .textContent()
  return Number((text ?? "").replace(/\D/g, ""))
}

const pixelOf = (canvas: Locator, rgb: readonly [number, number, number]) =>
  canvas.evaluate((element, [r, g, b]) => {
    if (!(element instanceof HTMLCanvasElement)) return null
    const context = element.getContext("2d")
    if (context === null) return null
    const { data, width, height } = context.getImageData(0, 0, element.width, element.height)
    const ratio = width / element.getBoundingClientRect().width
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] === r && data[at + 1] === g && data[at + 2] === b && data[at + 3] === 255) {
        const pixel = at / 4
        const x = pixel % width
        const y = Math.floor(pixel / width)
        return y < height ? { x: x / ratio, y: y / ratio } : null
      }
    }
    return null
  }, rgb)

const tagColor = [139, 92, 246] as const

test("g g opens the graph view, whose settings filter journals and orphans and stay after a reload", async ({
  page,
}) => {
  await openShowcaseAt(page, "/")
  await page.keyboard.press("g")
  await page.keyboard.press("g")
  await expect(page).toHaveURL(/\/graph$/)
  await expect(page).toHaveTitle("Graph view")
  await expect(graphCanvas(page)).toBeVisible()
  await expect(page.getByText("Preparing graph…")).toHaveCount(0)
  await page.getByRole("button", { name: "Graph settings" }).click()
  const settings = page.getByRole("region", { name: "Graph settings" })
  const journals = settings.getByRole("switch", { name: "Show journals" })
  const orphans = settings.getByRole("switch", { name: "Orphan pages" })
  await expect(journals).toHaveAttribute("aria-checked", "false")
  await expect(orphans).toHaveAttribute("aria-checked", "true")
  const pagesOnly = await nodeCount(page)
  expect(pagesOnly).toBeGreaterThan(0)
  await journals.click()
  await expect.poll(() => nodeCount(page)).toBeGreaterThan(pagesOnly)
  const withJournals = await nodeCount(page)
  await orphans.click()
  await expect.poll(() => nodeCount(page)).toBeLessThan(withJournals)
  const linkedOnly = await nodeCount(page)
  await page.reload()
  await page.getByRole("button", { name: "Graph settings" }).click()
  await expect(journals).toHaveAttribute("aria-checked", "true")
  await expect(orphans).toHaveAttribute("aria-checked", "false")
  expect(await nodeCount(page)).toBe(linkedOnly)
})

test("double-clicking a node in the graph view opens its page", async ({ page }) => {
  await openShowcaseAt(page, "/graph")
  const canvas = graphCanvas(page)
  await expect(page.getByText("Preparing graph…")).toHaveCount(0)
  await expect.poll(() => pixelOf(canvas, tagColor)).not.toBeNull()
  const point = await pixelOf(canvas, tagColor)
  if (point === null) throw new Error("no tag node drawn")
  const box = await canvas.boundingBox()
  await page.mouse.dblclick((box?.x ?? 0) + point.x + 1, (box?.y ?? 0) + point.y + 2)
  await expect(page).toHaveURL(/\/page\/[^/]+$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})

test("the right sidebar's Page graph follows the page you are on", async ({ page }) => {
  await openShowcaseAt(page, "/page/garden%20plan")
  await page.keyboard.press("t")
  await page.keyboard.press("r")
  await page.getByRole("button", { name: "Page graph", exact: true }).click()
  const pageGraph = page.getByRole("application", { name: "Page graph" })
  await expect(pageGraph).toBeVisible()
  await expect.poll(() => pixelOf(pageGraph, [37, 99, 235])).not.toBeNull()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+k")
  const palette = page.getByRole("dialog", { name: "Search" })
  await palette.getByRole("searchbox", { name: "Search" }).fill("sourdough")
  await expect(palette.getByRole("option").first()).toHaveText("Sourdough")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/page\/sourdough$/)
  await expect(pageGraph).toBeVisible()
  await expect.poll(() => pixelOf(pageGraph, [37, 99, 235])).not.toBeNull()
})
