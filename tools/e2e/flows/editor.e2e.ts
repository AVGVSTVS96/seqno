import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const welcome = "Welcome to the seqno demo graph"
const second = "Open Getting started to see how pages link"

const caretX = (page: Page) =>
  page.evaluate(() => {
    const selection = window.getSelection()
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null
    return range?.getClientRects()[0]?.x ?? Number.NaN
  })

test.beforeEach(async ({ page, seqno }) => {
  await seqno.openDemoGraph()
  await seqno.today.getByRole("treeitem").filter({ hasText: welcome }).click()
  await page.keyboard.press("End")
})

test("keys typed right after Enter land in the new block", async ({ page, seqno }) => {
  await page.keyboard.press("Enter")
  await page.keyboard.type("typed without waiting")
  await expect(seqno.today.getByRole("treeitem")).toHaveText([
    welcome,
    "typed without waiting",
    second,
  ])
})

test("a burst of Enter, text and Tab builds the outline in order", async ({ page, seqno }) => {
  for (const key of ["Enter", "a", "b", "Enter", "c", "d", "Tab", "e", "Escape"]) {
    await page.keyboard.press(key)
  }
  await expect(seqno.today.getByRole("treeitem")).toHaveText([welcome, "ab", "cde", second])
  await expect(seqno.today.getByRole("treeitem", { level: 2 })).toHaveText(["cde"])
})

test("Enter, Backspace and typing at machine speed lose no keys", async ({ page, seqno }) => {
  for (const key of ["Enter", "Backspace", "X", "Y", "Z"]) await page.keyboard.press(key)
  await expect(seqno.editor).toHaveText(`${welcome}XYZ`)
  await page.keyboard.press("Escape")
  await expect(seqno.today.getByRole("treeitem")).toHaveText([`${welcome}XYZ`, second])
})

test("ArrowDown keeps the caret's horizontal position", async ({ page, seqno }) => {
  await page.keyboard.press("Home")
  for (let step = 0; step < "Welcome to".length; step++) await page.keyboard.press("ArrowRight")
  const before = await caretX(page)
  await page.keyboard.press("ArrowDown")
  await expect(seqno.editor).toHaveText("Open [[Getting started]] to see how pages link")
  expect(Math.abs((await caretX(page)) - before)).toBeLessThan(6)
  await page.keyboard.press("ArrowUp")
  expect(Math.abs((await caretX(page)) - before)).toBeLessThan(1)
})

test("the slash menu lists commands and runs the chosen one", async ({ page, seqno }) => {
  await page.keyboard.type(" /")
  const menu = page.getByRole("listbox", { name: "Commands" })
  await expect(menu.getByRole("option", { selected: true })).toHaveText("Page reference")
  await page.keyboard.type("todo")
  await expect(menu.getByRole("option").first()).toHaveText("TODO")
  await page.keyboard.press("Enter")
  await expect(seqno.editor).toHaveText(`TODO ${welcome} `)
  await expect(menu).toHaveCount(0)
})

test("[[ suggests pages and completes the reference", async ({ page, seqno }) => {
  await page.keyboard.type(" [[Get")
  const popup = page.getByRole("listbox", { name: "Search for a page" })
  await expect(popup.getByRole("option", { selected: true })).toHaveText("Getting started")
  await page.keyboard.press("Enter")
  await expect(seqno.editor).toHaveText(`${welcome} [[Getting started]]`)
  await page.keyboard.type("!")
  await expect(seqno.editor).toHaveText(`${welcome} [[Getting started]]!`)
})

test("Mod+Enter rotates the task marker", async ({ page, seqno }) => {
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(seqno.editor).toHaveText(`TODO ${welcome}`)
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(seqno.editor).toHaveText(`DOING ${welcome}`)
})

test("Delete at the end pulls the next block in", async ({ page, seqno }) => {
  await page.keyboard.press("Delete")
  await expect(seqno.editor).toHaveText(`${welcome}Open [[Getting started]] to see how pages link`)
  await page.keyboard.type("!")
  await expect(seqno.editor).toHaveText(`${welcome}!Open [[Getting started]] to see how pages link`)
})

test("Backspace at the start merges, and typing goes in at the seam", async ({ page, seqno }) => {
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Home")
  await page.keyboard.press("Backspace")
  await page.keyboard.type("+")
  await expect(seqno.editor).toHaveText(`${welcome}+Open [[Getting started]] to see how pages link`)
  await page.keyboard.press("Escape")
  await expect(seqno.today.getByRole("treeitem")).toHaveText([`${welcome}+${second}`])
})

test("Mod+O follows the ref under the caret, Mod+Shift+O opens it in the sidebar", async ({
  page,
}) => {
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Home")
  for (let step = 0; step < "Open [[G".length; step++) await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ControlOrMeta+Shift+O")
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" })
  await expect(sidebar.getByRole("treeitem").first()).toBeVisible()
  await expect(sidebar.getByRole("button", { name: /Getting started/ }).first()).toBeVisible()
  await page.keyboard.press("ControlOrMeta+O")
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Getting started" }),
  ).toBeVisible()
})

test("Alt+Right zooms into the edited block and Alt+Left zooms back out", async ({ page }) => {
  await page.keyboard.press("Alt+ArrowRight")
  await expect(page).toHaveURL(/zoom=/)
  const main = page.getByRole("main")
  await expect(main.getByRole("treeitem")).toHaveText([welcome])
  await main.getByRole("treeitem").getByText(welcome).click()
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(page).not.toHaveURL(/zoom=/)
  await expect(main.getByRole("treeitem").filter({ hasText: second })).toBeVisible()
})
