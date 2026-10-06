import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const openShowcaseAt = async (page: Page, path: string) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await page.goto(path)
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Search" })

const openWithPalette = async (page: Page, text: string, title: string) => {
  await page.keyboard.press("Control+k")
  await palette(page).getByRole("searchbox", { name: "Search" }).fill(text)
  await expect(palette(page).getByRole("option").first()).toHaveText(title)
  await page.keyboard.press("Enter")
  await expect(palette(page)).toHaveCount(0)
}

test("the palette opens a page, which lists the blocks linking to it by page", async ({ page }) => {
  await openShowcaseAt(page, "/")
  await openWithPalette(page, "garden plan", "Garden Plan")
  await expect(page).toHaveURL(/\/page\/garden%20plan$/)
  const linked = page.getByRole("region", { name: /^Linked references/ })
  const groups = linked.getByRole("region")
  await expect(groups).toHaveCount(3)
  await expect(groups.nth(0)).toHaveAccessibleName("Oct 6th, 2026")
  await expect(groups.nth(1)).toHaveAccessibleName("Seed Inventory")
  await expect(groups.nth(2)).toContainText(
    "An alias reaches its page: Allotment is the Garden Plan.",
  )
  await linked.getByRole("button", { name: /^Linked references/ }).click()
  await expect(linked.getByRole("treeitem")).toHaveCount(0)
})

test("a plain mention shows up under unlinked references, folded until opened", async ({
  page,
}) => {
  await openShowcaseAt(page, "/page/reading%20list")
  await page.getByRole("treeitem").filter({ hasText: "Books to finish" }).first().click()
  await page.keyboard.press("End")
  await page.keyboard.type(" for the Garden Plan")
  await page.keyboard.press("Escape")
  await openWithPalette(page, "garden plan", "Garden Plan")
  const unlinked = page.getByRole("region", { name: "Unlinked references" })
  await expect(unlinked).toBeVisible()
  await expect(unlinked.getByRole("treeitem")).toHaveCount(0)
  await unlinked.getByRole("button", { name: "Unlinked references" }).click()
  await expect(unlinked.getByRole("treeitem").first()).toContainText(
    "Books to finish this autumn for the Garden Plan",
  )
})

test("clicking a page title renames the page", async ({ page }) => {
  await openShowcaseAt(page, "/page/sourdough")
  await page.getByRole("heading", { level: 1, name: "Sourdough" }).click()
  const title = page.getByRole("textbox", { name: "Page title" })
  await title.press("End")
  await title.pressSequentially(" starter")
  await title.press("Enter")
  await expect(page).toHaveURL(/\/page\/sourdough%20starter$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sourdough starter")
})

test("all pages hides journals, sorts by title and filters", async ({ page }) => {
  await openShowcaseAt(page, "/all-pages")
  const table = page.getByRole("table", { name: "All pages" })
  const names = table.locator("tbody tr td:nth-child(2)")
  await expect(names.first()).toBeVisible()
  await page.getByRole("button", { name: "Include journals" }).click()
  await table.getByRole("button", { name: "Page name" }).click()
  await expect(names).toHaveText([
    "design",
    "Garden Plan",
    "greenhouse",
    "projects/Greenhouse",
    "Reading List",
    "Seed Inventory",
    "Showcase",
    "Sourdough",
    "visual check",
  ])
  await page.getByRole("button", { name: "Search pages" }).click()
  await page.getByRole("searchbox", { name: "Search pages" }).fill("gar")
  await expect(names).toHaveText(["Garden Plan"])
})

test("a page created from the palette opens with the caret in its first block", async ({
  page,
  seqno,
}) => {
  await openShowcaseAt(page, "/")
  await page.keyboard.press("Control+k")
  await palette(page).getByRole("searchbox", { name: "Search" }).fill("Potting Bench")
  await expect(palette(page).getByRole("option").first()).toContainText("Create page")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/page\/potting%20bench$/)
  await expect(seqno.editor).toBeFocused()
  await page.keyboard.type("typed")
  await expect(seqno.editor).toHaveText("typed")
})

test("# suggests a tag that exists only as a tag, and search finds it", async ({ page }) => {
  await openShowcaseAt(page, "/page/reading%20list")
  await page.getByRole("treeitem").filter({ hasText: "Books to finish" }).first().click()
  await page.keyboard.press("End")
  await page.keyboard.type(" #gre")
  const popup = page.getByRole("listbox", { name: "Search for a tag" })
  await expect(popup.getByRole("option", { selected: true })).toHaveText("greenhouse")
  await expect(popup.getByRole("option").nth(1)).toHaveText("New tag gre")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+k")
  await palette(page).getByRole("searchbox", { name: "Search" }).fill("greenhouse")
  await expect(palette(page).getByRole("option").first()).toHaveText("greenhouse")
  await expect(palette(page).getByText("Create page")).toHaveCount(0)
})

test("Shift+Enter in the palette opens the result in the right sidebar", async ({ page }) => {
  await openShowcaseAt(page, "/")
  await page.keyboard.press("Control+k")
  await palette(page).getByRole("searchbox", { name: "Search" }).fill("seed inventory")
  await expect(palette(page).getByRole("option").first()).toHaveText("Seed Inventory")
  await page.keyboard.press("Shift+Enter")
  await expect(page.getByRole("complementary", { name: "Right sidebar" })).toContainText(
    "Tomato, San Marzano",
  )
})

test("a second tab waits for the graph while the first one has it open", async ({ page }) => {
  await openShowcaseAt(page, "/")
  await expect(page.getByRole("article").first()).toBeVisible()
  const second = await page.context().newPage()
  await second.goto("/")
  await expect(
    second.getByRole("heading", { name: "This graph is open in another tab" }),
  ).toBeVisible()
  await page.close()
  await expect(second.getByRole("article").first()).toBeVisible()
})

test("the journals list mounts the newest days first and more as it scrolls", async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), "seqno-journals-"))
  await mkdir(join(folder, "journals"))
  await Promise.all(
    Array.from({ length: 12 }, (_, day) =>
      writeFile(
        join(folder, "journals", `2025_01_${String(day + 1).padStart(2, "0")}.md`),
        `- day ${day + 1}\n`,
      ),
    ),
  )
  await seedOpfs(page, folder, ["graphs", "demo"])
  await rm(folder, { recursive: true })
  await page.goto("/")
  const days = page.getByRole("article")
  await expect(days.nth(1)).toHaveAccessibleName("Jan 12th, 2025")
  expect(await days.count()).toBeLessThan(13)
  await expect(async () => {
    await page.mouse.move(700, 500)
    await page.mouse.wheel(0, 4000)
    await expect(days).toHaveCount(13, { timeout: 500 })
  }).toPass()
})
