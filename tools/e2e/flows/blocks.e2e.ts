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

test("pasting a markdown outline into an empty block makes the blocks", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/")
  const today = page.getByRole("main").getByRole("article").first()
  await today.getByRole("treeitem").first().click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.evaluate(() =>
    navigator.clipboard.writeText("- pasted one\n  - pasted child\n- pasted two"),
  )
  await page.keyboard.press("ControlOrMeta+v")
  await page.keyboard.press("Escape")
  await expect(today.getByRole("treeitem")).toHaveText([
    "Welcome to the seqno demo graph",
    "pasted one",
    "pasted child",
    "pasted two",
    "Open Getting started to see how pages link",
  ])
  await expect(today.getByRole("treeitem", { level: 2 })).toHaveText(["pasted child"])
})

test("resting on a page ref previews the page, and leaving closes it", async ({ page }) => {
  await openShowcase(page, "/")
  const ref = page.getByRole("main").getByRole("link", { name: "Garden Plan" }).first()
  await ref.hover()
  const preview = page.getByRole("dialog", { name: "Preview" })
  await expect(preview).toBeVisible({ timeout: 3000 })
  await expect(preview).toContainText("Garden Plan")
  await expect(preview.getByRole("treeitem").first()).toHaveText(
    "Beds run north to south so neither row shades the other.",
  )
  await page.mouse.move(1200, 860)
  await expect(preview).toHaveCount(0, { timeout: 3000 })
})
