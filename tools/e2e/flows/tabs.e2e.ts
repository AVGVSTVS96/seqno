import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, restOfToday, saved, test, todayOn } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const welcome = "Welcome to the seqno demo graph"
const second = "Open Getting started to see how pages link"

const anotherTab = async (page: Page) => {
  const other = await page.context().newPage()
  const errors: Array<string> = []
  other.on("pageerror", (error) => errors.push(error.message))
  await other.goto("/")
  await expect(todayOn(other).getByRole("treeitem").first()).toHaveText(welcome)
  return { other, errors }
}

const editEnd = async (page: Page, text: string) => {
  await todayOn(page).getByRole("treeitem").filter({ hasText: text }).click()
  await page.keyboard.press("End")
}

test.beforeEach(async ({ seqno }) => {
  await seqno.openDemoGraph()
})

test("a second tab opens the same graph, and each tab sees what the other types", async ({
  page,
  seqno,
}) => {
  const { other, errors } = await anotherTab(page)
  await editEnd(page, welcome)
  await page.keyboard.type(", typed in the first tab")
  await expect(todayOn(other).getByRole("treeitem").first()).toHaveText(
    `${welcome}, typed in the first tab`,
  )
  await editEnd(other, second)
  await other.keyboard.type(", and this in the second")
  await expect(seqno.today.getByRole("treeitem")).toHaveText([
    `${welcome}, typed in the first tab`,
    `${second}, and this in the second`,
    ...restOfToday,
  ])
  expect(errors).toEqual([])
})

test("Ctrl+Z in one tab takes back only what that tab typed into a block both edited", async ({
  page,
  seqno,
}) => {
  const { other, errors } = await anotherTab(page)
  await editEnd(page, welcome)
  await page.keyboard.type(", first")
  await expect(todayOn(other).getByRole("treeitem").first()).toHaveText(`${welcome}, first`)
  await editEnd(other, welcome)
  await other.keyboard.type(", second")
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText(`${welcome}, first, second`)
  await page.keyboard.press("ControlOrMeta+z")
  await expect(todayOn(other).getByRole("treeitem").first()).toHaveText(`${welcome}, second`)
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(todayOn(other).getByRole("treeitem").first()).toHaveText(`${welcome}, first, second`)
  expect(errors).toEqual([])
})

test("two tabs typing at the same time keep every key", async ({ page, seqno }) => {
  const { other, errors } = await anotherTab(page)
  await editEnd(page, welcome)
  await editEnd(other, second)
  for (const key of "0123456789") {
    await page.keyboard.press(key)
    await other.keyboard.press(key)
  }
  await page.keyboard.press("Escape")
  await other.keyboard.press("Escape")
  const both = [`${welcome}0123456789`, `${second}0123456789`, ...restOfToday]
  await expect(seqno.today.getByRole("treeitem")).toHaveText(both)
  await expect(todayOn(other).getByRole("treeitem")).toHaveText(both)
  expect(errors).toEqual([])
})

test("closing the tab that opened the graph first loses nothing, and the other keeps editing", async ({
  page,
  seqno,
}) => {
  const { other, errors } = await anotherTab(page)
  await editEnd(page, welcome)
  await page.keyboard.type(", typed right before closing")
  await expect(seqno.editor).toHaveText(`${welcome}, typed right before closing`)
  await page.close()
  await expect(todayOn(other).getByRole("treeitem").first()).toHaveText(
    `${welcome}, typed right before closing`,
  )
  await editEnd(other, second)
  await other.keyboard.type(", typed after it closed")
  await other.keyboard.press("Escape")
  await saved(other)
  await other.reload()
  await expect(todayOn(other).getByRole("treeitem")).toHaveText([
    `${welcome}, typed right before closing`,
    `${second}, typed after it closed`,
    ...restOfToday,
  ])
  expect(errors).toEqual([])
})

test("reloading a tab right after typing loses nothing while another tab has the graph", async ({
  page,
  seqno,
}) => {
  const { other, errors } = await anotherTab(page)
  await editEnd(page, welcome)
  await page.keyboard.type(", typed right before reloading")
  await expect(seqno.editor).toHaveText(`${welcome}, typed right before reloading`)
  await page.reload()
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText(
    `${welcome}, typed right before reloading`,
  )
  await expect(todayOn(other).getByRole("treeitem").first()).toHaveText(
    `${welcome}, typed right before reloading`,
  )
  expect(errors).toEqual([])
})

test("closing the only tab right after typing keeps the edit", async ({ page, seqno }) => {
  await editEnd(page, welcome)
  await page.keyboard.type(", typed right before the last tab closed")
  await expect(seqno.editor).toHaveText(`${welcome}, typed right before the last tab closed`)
  const context = page.context()
  await page.close()
  const next = await context.newPage()
  await next.goto("/")
  await expect(todayOn(next).getByRole("treeitem").first()).toHaveText(
    `${welcome}, typed right before the last tab closed`,
  )
})

test("the header shows a save in progress only while it lasts", async ({ page, seqno }) => {
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved")
  await editEnd(page, welcome)
  await page.keyboard.type(", saved")
  await expect(seqno.editor).toHaveText(`${welcome}, saved`)
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved")
  await page.reload()
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText(`${welcome}, saved`)
})
