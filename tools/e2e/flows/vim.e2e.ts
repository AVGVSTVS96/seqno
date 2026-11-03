import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, restOfToday, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const welcome = "Welcome to the seqno demo graph"
const second = "Open Getting started to see how pages link"

const turnOnVim = (page: Page) =>
  page.addInitScript(() => localStorage.setItem("seqno.vimMode", "true"))

const press = async (page: Page, ...keys: ReadonlyArray<string>) => {
  for (const key of keys) await page.keyboard.press(key)
}

const selectedTexts = (page: Page) => page.getByRole("treeitem", { selected: true })

test("Vim mode is a switch in Settings, and it stays on after a reload", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  const settings = page.getByRole("dialog", { name: "Settings" })
  const vim = settings.getByRole("switch", { name: "Vim mode" })
  await expect(vim).toHaveAttribute("aria-checked", "false")
  await vim.click()
  await expect(vim).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")
  await page.reload()
  await seqno.today.getByRole("treeitem").filter({ hasText: welcome }).click()
  await page.keyboard.press("End")
  await press(page, "Escape", "b", "d", "w")
  await expect(seqno.editor).toHaveText("Welcome to the seqno demo ")
})

test.describe("with Vim mode on", () => {
  test.beforeEach(async ({ page, seqno }) => {
    await turnOnVim(page)
    await seqno.openDemoGraph()
    await seqno.today.getByRole("treeitem").filter({ hasText: welcome }).click()
    await page.keyboard.press("End")
  })

  test("a block opens in insert mode, Escape gives normal mode, and Escape again selects the block", async ({
    page,
    seqno,
  }) => {
    await page.keyboard.type("!")
    await press(page, "Escape", "0", "c", "w")
    await page.keyboard.type("Hello")
    await expect(seqno.editor).toHaveText("Hello to the seqno demo graph!")
    await press(page, "Escape", "Escape")
    await expect(seqno.editor).toHaveCount(0)
    await expect(selectedTexts(page)).toHaveText(["Hello to the seqno demo graph!"])
  })

  test("j and k in normal mode walk from block to block like lines", async ({ page, seqno }) => {
    await press(page, "Escape", "0", "l", "l", "j", "x")
    await expect(seqno.editor).toHaveText("Opn [[Getting started]] to see how pages link")
    await press(page, "k", "x")
    await expect(seqno.editor).toHaveText("Wecome to the seqno demo graph")
  })

  test("o opens a block below in insert mode, and what you type at once lands in it", async ({
    page,
    seqno,
  }) => {
    await page.keyboard.press("Escape")
    await page.keyboard.press("o")
    await page.keyboard.type("typed without waiting")
    await press(page, "Escape", "Escape")
    await expect(seqno.today.getByRole("treeitem")).toHaveText([
      welcome,
      "typed without waiting",
      second,
      ...restOfToday,
    ])
  })

  test("selected blocks take j, dd, p and u", async ({ page, seqno }) => {
    await press(page, "Escape", "Escape", "j")
    await expect(selectedTexts(page)).toHaveText([second])
    await press(page, "d", "d")
    await expect(seqno.today.getByRole("treeitem")).toHaveText([welcome, ...restOfToday])
    await page.keyboard.press("p")
    await expect(seqno.today.getByRole("treeitem")).toHaveText([
      welcome,
      restOfToday[0] ?? "",
      second,
      restOfToday[1] ?? "",
    ])
    await press(page, "u", "u")
    await expect(seqno.today.getByRole("treeitem")).toHaveText([welcome, second, ...restOfToday])
    await expect(seqno.editor).toHaveCount(0)
    await expect(selectedTexts(page)).toHaveText([second])
  })
})
