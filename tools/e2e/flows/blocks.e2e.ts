import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const openShowcase = async (page: Page, path: string) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await page.goto(path)
}

const rowWith = (page: Page, text: string) =>
  page
    .getByRole("main")
    .getByRole("treeitem")
    .filter({ hasText: new RegExp(`^${text}`) })
    .first()

test("right-clicking a bullet selects the block and opens its menu", async ({ page }) => {
  await openShowcase(page, "/page/garden%20plan")
  const winter = rowWith(page, "Winter")
  await winter.getByRole("button", { name: "Zoom into block" }).first().click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Block actions" })
  await expect(menu).toBeVisible()
  await expect(winter).toHaveAttribute("aria-selected", "true")
  await menu.getByRole("button", { name: "yellow background" }).click()
  await expect(menu).toHaveCount(0)
  await expect(winter.locator(".seqno-block-bg").first()).toHaveText("Winter")
  await winter.getByRole("button", { name: "Zoom into block" }).first().click({ button: "right" })
  await menu.getByRole("button", { name: "Heading 2" }).click()
  await expect(winter.getByRole("heading", { level: 2, name: "Winter" })).toBeVisible()
  await winter.getByRole("button", { name: "Zoom into block" }).first().click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Collapse all" }).click()
  await expect(winter).toHaveAttribute("aria-expanded", "false")
  await winter.getByRole("button", { name: "Zoom into block" }).first().click({ button: "right" })
  await menu.getByRole("menuitem", { name: /^Delete selected blocks/ }).click()
  await expect(rowWith(page, "Winter")).toHaveCount(0)
})
