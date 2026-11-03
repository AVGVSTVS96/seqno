import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { journalTitle } from "../src/journal.ts"
import { expect, openDemo, restOfToday, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const palette = (page: Page) => page.getByRole("dialog", { name: "Search" })

const runCommand = async (page: Page, text: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  await palette(page).getByRole("searchbox", { name: "Search" }).fill(text)
  await expect(
    palette(page).getByRole("listbox", { name: "Commands" }).getByRole("option").first(),
  ).toContainText(text)
  await page.keyboard.press("Enter")
  await expect(palette(page)).toHaveCount(0)
}

const shifted = (days: number) => {
  const date = new Date()
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

const title = (page: Page) => page.getByRole("main").getByRole("heading", { level: 1 })

test("g t goes to tomorrow, and g p and g n step a day back and forth from the journal shown", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await page.keyboard.press("g")
  await page.keyboard.press("t")
  await expect(title(page)).toHaveText(journalTitle(shifted(1)))
  await page.keyboard.press("g")
  await page.keyboard.press("p")
  await expect(title(page)).toHaveText(journalTitle(new Date()))
  await runCommand(page, "Go to previous journal")
  await expect(title(page)).toHaveText(journalTitle(shifted(-1)))
  await runCommand(page, "Go to next journal")
  await expect(title(page)).toHaveText(journalTitle(new Date()))
})

test("t o collapses every block on the page, and again expands them", async ({ page }) => {
  await openDemo(page, "/page/getting%20started")
  const outline = page.getByRole("main").getByRole("treeitem")
  const child = outline.filter({ hasText: "Click any block to edit it" })
  await expect(child).toBeVisible()
  await page.keyboard.press("t")
  await page.keyboard.press("o")
  await expect(child).toHaveCount(0)
  await runCommand(page, "Toggle open blocks")
  await expect(child).toBeVisible()
})

test("selected blocks take t n, Mod+;, Alt+arrows and the arrow that opens them", async ({
  page,
}) => {
  await openDemo(page, "/page/getting%20started")
  const outline = page.getByRole("main").getByRole("treeitem")
  const parent = outline.filter({ has: page.getByText("Outline", { exact: true }) }).first()
  const child = outline.filter({ hasText: "Click any block to edit it" })
  await child.click()
  await page.keyboard.press("Alt+ArrowUp")
  await expect(child).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Alt+ArrowUp")
  await expect(parent).toHaveAttribute("aria-selected", "true")
  await expect(child).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Alt+ArrowDown")
  await expect(parent).toHaveAttribute("aria-selected", "false")
  await expect(child).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Escape")
  await parent.getByText("Outline", { exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(parent).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ControlOrMeta+Semicolon")
  await expect(child).toHaveCount(0)
  await runCommand(page, "Toggle expand")
  await expect(child).toBeVisible()
  await expect(parent).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("t")
  await page.keyboard.press("n")
  await expect(parent.getByText("1.", { exact: true })).toBeVisible()
  await runCommand(page, "Toggle number list")
  await expect(parent.getByText("1.", { exact: true })).toHaveCount(0)
  await page.keyboard.press("ArrowRight")
  await expect(parent.getByRole("textbox")).toBeFocused()
})

test("Select graph to open lists the other graphs, and offers to add one when there are none", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await page.keyboard.press("Alt+Shift+KeyG")
  const select = page.getByRole("dialog", { name: "Select a graph" })
  await expect(select.getByRole("textbox", { name: "Select a graph" })).toBeFocused()
  await expect(select.getByText("No matched graphs. Do you want to add another one?")).toBeVisible()
  await expect(select.getByRole("button", { name: "Yes, add another graph" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(select).toHaveCount(0)
})

test("Rebuild search index rebuilds it, and search still finds blocks", async ({ page, seqno }) => {
  await seqno.openDemoGraph()
  await runCommand(page, "Rebuild search index")
  await expect(page.getByText("Search indices rebuilt successfully!")).toBeVisible()
  await page.keyboard.press("ControlOrMeta+k")
  await palette(page).getByRole("searchbox", { name: "Search" }).fill("compost bin")
  await expect(
    palette(page).getByRole("listbox", { name: "Nodes" }).getByRole("option").first(),
  ).toContainText("compost bin")
})

test("Export public graph pages as html says when no page is public", async ({ page, seqno }) => {
  await seqno.openDemoGraph()
  await runCommand(page, "Export public graph pages as html")
  await expect(
    page.getByText("No page is public. Add public:: true to the pages to publish."),
  ).toBeVisible()
})

test("Copy page url copies the open page's address", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await openDemo(page, "/page/ideas")
  await runCommand(page, "Copy page url")
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/\/page\/ideas$/)
})

test("t d turns on document mode: bullets hide until hovered, Enter breaks the line and Shift+Enter makes a block", async ({
  page,
}) => {
  await openDemo(page, "/page/getting%20started")
  const outline = page.getByRole("main").getByRole("treeitem")
  const parent = outline.filter({ hasText: /^Outline/ }).first()
  const bullet = parent.getByRole("button", { name: "Zoom into block" }).first()
  await expect(bullet).toBeVisible()
  await page.keyboard.press("t")
  await page.keyboard.press("d")
  const toggle = page.getByRole("banner").getByRole("button", { name: "Turn off document mode" })
  await expect(toggle).toHaveText("D")
  await page.mouse.move(0, 0)
  await expect(bullet).toBeHidden()
  await parent.getByText("Outline", { exact: true }).hover()
  await expect(bullet).toBeVisible()
  await page.reload()
  await expect(toggle).toBeVisible()
  await parent.getByText("Outline", { exact: true }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.type("second line")
  await expect(parent.getByRole("textbox")).toHaveText(/Outline\s*second line/)
  await expect(outline.filter({ hasText: /^second line/ })).toHaveCount(0)
  await page.keyboard.press("Shift+Enter")
  await expect(parent.getByRole("textbox")).toHaveCount(0)
  await expect(page.getByRole("main").getByRole("textbox")).toHaveText("")
  await page.keyboard.press("Escape")
  await runCommand(page, "Toggle document mode")
  await expect(toggle).toHaveCount(0)
  await page.mouse.move(0, 0)
  await expect(bullet).toBeVisible()
})

test("c c picks an accent color that recolors links and stays after a reload, and c o resets it", async ({
  page,
}) => {
  await openDemo(page, "/page/getting%20started")
  const link = page.getByRole("main").getByRole("link", { name: "garden", exact: true }).first()
  const color = () => link.evaluate((element) => getComputedStyle(element).color)
  const classic = await color()
  await page.keyboard.press("c")
  await page.keyboard.press("c")
  const picker = page.getByRole("dialog", { name: "Accent color" })
  await expect(picker.getByText("Choosing an accent color may override any theme")).toBeVisible()
  await picker.getByRole("button", { name: "tomato color" }).click()
  await expect(picker.getByRole("button", { name: "tomato color" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(page.locator("html")).toHaveAttribute("data-color", "tomato")
  await expect.poll(color).not.toBe(classic)
  await page.keyboard.press("Escape")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color", "tomato")
  await page.keyboard.press("c")
  await page.keyboard.press("o")
  await expect(page.locator("html")).toHaveAttribute("data-color", "logseq")
  await expect.poll(color).toBe(classic)
})

test("Mod+C Mod+B hides page link brackets in config.edn, and the palette shows them again", async ({
  page,
}) => {
  await openDemo(page, "/page/getting%20started")
  const ref = page.getByRole("main").locator(".seqno-pageref", { hasText: "garden" }).first()
  const brackets = ref.locator(".bracket")
  const opening = () =>
    brackets.first().evaluate((element) => getComputedStyle(element, "::before").content)
  await expect.poll(opening).toBe('"[["')
  await expect(brackets).toHaveCount(2)
  await page.keyboard.press("ControlOrMeta+KeyC")
  await page.keyboard.press("ControlOrMeta+KeyB")
  await expect(brackets).toHaveCount(0)
  await page.reload()
  await expect(ref).toBeVisible()
  await expect(brackets).toHaveCount(0)
  await runCommand(page, "Toggle whether to display brackets")
  await expect(brackets).toHaveCount(2)
})

test("journals can be deleted: today's comes back empty, and undo restores it", async ({
  page,
}) => {
  await openDemo(page)
  const main = page.getByRole("main")
  await expect(main.getByText(restOfToday[0] ?? "")).toBeVisible()
  await page.getByRole("banner").getByRole("button", { name: "More" }).click()
  await page
    .getByRole("menu", { name: "More" })
    .getByRole("menuitem", { name: "Delete page" })
    .click()
  await page
    .getByRole("dialog", { name: "Delete page" })
    .getByRole("button", { name: "Confirm" })
    .click()
  await expect(main.getByText(restOfToday[0] ?? "")).toHaveCount(0)
  await expect(main.getByText(journalTitle(new Date()), { exact: true }).first()).toBeVisible()
  await main.getByRole("article").nth(1).getByRole("treeitem").first().click()
  await page.keyboard.press("ControlOrMeta+z")
  await page.keyboard.press("ControlOrMeta+z")
  await expect(main.getByText(restOfToday[0] ?? "")).toBeVisible()
})
