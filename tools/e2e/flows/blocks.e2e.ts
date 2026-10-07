import type { Page } from "@playwright/test"
import { scrollToText } from "../design/seqno.ts"
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
  const bullet = await winter.getByRole("button", { name: "Zoom into block" }).first().boundingBox()
  const pointer = { x: (bullet?.x ?? 0) + 8, y: (bullet?.y ?? 0) + 8 }
  await page.mouse.click(pointer.x, pointer.y, { button: "right" })
  const menu = page.getByRole("menu", { name: "Block actions" })
  await expect(menu).toBeVisible()
  await menu.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  )
  const box = await menu.boundingBox()
  expect([(box?.x ?? 0) - pointer.x, (box?.y ?? 0) - pointer.y]).toEqual([-139, 5])
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

test("clicking into a code block edits the code in place", async ({ page }) => {
  await openShowcase(page, "/page/showcase")
  await scrollToText(page, "def water", 120)
  const block = page.locator(".seqno-codeblock").filter({ hasText: "def water" })
  const before = await block.boundingBox()
  await block.getByText("for bed in beds:").click()
  await expect(block.locator(".cm-editor")).toBeVisible()
  expect((await block.boundingBox())?.height).toBe(before?.height)
  await page.keyboard.press("End")
  await page.keyboard.type("  # every bed")
  await page.keyboard.press("Escape")
  await expect(block.locator(".cm-editor")).toHaveCount(0)
  await expect(block).toContainText("for bed in beds:  # every bed")
})

test("clicking under the last block adds a block and edits it", async ({ page, seqno }) => {
  await openShowcase(page, "/page/garden%20plan")
  const strip = page
    .getByRole("article", { name: "Garden Plan" })
    .getByRole("button", { name: "Add a block" })
  await expect(strip).toHaveCSS("opacity", "0")
  await strip.hover()
  await expect(strip).toHaveCSS("opacity", "0.5")
  await strip.click()
  await expect(seqno.editor).toHaveText("")
  await page.keyboard.type("Autumn")
  await page.keyboard.press("Escape")
  const tree = page.getByRole("main").getByRole("tree").first()
  await expect(tree.getByRole("treeitem", { level: 1 }).last()).toHaveText(/^Autumn/)
})

test("a block's reference count opens the blocks that reference it, open when zoomed in", async ({
  page,
}) => {
  await openShowcase(page, "/page/showcase")
  await scrollToText(page, "Water in the morning", 100)
  const rule = rowWith(page, "Water in the morning")
  const count = rule.getByRole("button", { name: "2 references" }).first()
  const panel = rule.getByRole("region", { name: "Block references" }).first()
  await count.click()
  await expect(count).toHaveAttribute("aria-expanded", "true")
  await expect(panel.getByRole("region")).toHaveAccessibleName("Showcase")
  await expect(panel.getByRole("navigation", { name: "Parent blocks" })).toHaveText([
    "References",
    "ReferencesThe same rule, embedded:",
  ])
  await expect(panel.getByRole("treeitem").first()).toHaveText(
    /^The rule above, by reference: Water in the morning, never at night\./,
  )
  await count.click()
  await expect(panel).toHaveCount(0)
  await rule.getByRole("button", { name: "Zoom into block" }).first().click()
  await expect(
    rowWith(page, "Water in the morning").getByRole("region", { name: "Block references" }).first(),
  ).toBeVisible()
})
