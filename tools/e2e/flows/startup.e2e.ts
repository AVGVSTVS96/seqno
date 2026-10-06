import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const beds = "Beds run north to south so neither row shades the other."

const pageCount = async (page: Page) => {
  await page.goto("/all-pages")
  const count = page.locator(".seqno-view-count")
  await expect(count).not.toHaveText("0")
  return count.textContent()
}

test("the app opens the last graph on every load and a reload keeps the route", async ({
  page,
}) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await page.goto("/page/garden%20plan")
  const title = page.getByRole("main").getByRole("heading", { level: 1, name: "Garden Plan" })
  await expect(title).toBeVisible()
  await expect(page).toHaveTitle("Garden Plan")
  await page.reload()
  await expect(title).toBeVisible()
  await expect(page).toHaveURL(/\/page\/garden%20plan$/)
  await expect(page.getByRole("button", { name: "Open the demo graph" })).toHaveCount(0)
})

test("all graphs is a page in the shell, reached from the graph switcher", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Demo" }).click()
  await page.getByRole("menuitem", { name: "All graphs" }).click()
  await expect(page).toHaveURL(/\/graphs$/)
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: "All graphs" })).toBeVisible()
  await expect(main.getByRole("button", { name: "Demo", exact: true })).toBeVisible()
  await expect(main.getByText(/^Last opened at: /)).toBeVisible()
  await expect(page.getByRole("banner")).toBeVisible()
})

test("Ctrl+Z after a reload undoes only the last edit", async ({ page, seqno }) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  const pages = await pageCount(page)
  await page.goto("/page/garden%20plan")
  await page.reload()
  await page.getByRole("treeitem").filter({ hasText: beds }).first().getByText(beds).click()
  await page.keyboard.press("End")
  await page.keyboard.type("!")
  await expect(seqno.editor).toHaveText(`${beds}!`)
  await page.keyboard.press("ControlOrMeta+z")
  await expect(seqno.editor).toHaveText(beds)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("main").getByRole("heading", { name: "Garden Plan" })).toBeVisible()
  await seqno.saved()
  await page.reload()
  expect(await pageCount(page)).toBe(pages)
})
