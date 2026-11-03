import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, test } from "../src/test.ts"
import { board, drag, firePaste, newBoard, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

const drawBox = async (page: Page) => {
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await page.mouse.click(800, 600)
}

test("Export in the right-click menu saves a PNG of just the selected shapes, 8px around them", async ({
  page,
}) => {
  await newBoard(page)
  await drawBox(page)
  await page.keyboard.press("o")
  await drag(page, [600, 300], [700, 400])
  await page.mouse.click(800, 600)
  await page.mouse.click(350, 350, { button: "right" })
  await page.getByRole("menuitem", { name: "Export", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Export" })
  await expect(dialog.getByRole("group", { name: "Format" }).getByRole("button")).toHaveCount(0)
  const picture = dialog.getByRole("img", { name: "Exported picture" })
  await expect(picture.locator('.wb-shape[data-type="box"]')).toHaveCount(1)
  await expect(picture.locator('.wb-shape[data-type="ellipse"]')).toHaveCount(0)
  await expect(dialog.getByRole("checkbox", { name: "Transparent background" })).toBeVisible()
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Save to file" }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^seqno_[0-9a-f-]{36}\.png$/)
  const png = await readFile((await file.path()) ?? "")
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect(png.readUInt32BE(16)).toBe(116)
  expect(png.readUInt32BE(20)).toBe(116)
})

test("a click on the one selected shape starts editing it, and on an embed starts it", async ({
  page,
}) => {
  await newBoard(page)
  await drawBox(page)
  await page.mouse.click(350, 350)
  await expect(page.getByRole("textbox", { name: "Label" })).toHaveCount(0)
  await page.mouse.click(350, 350)
  await expect(page.getByRole("textbox", { name: "Label" })).toBeFocused()
  await page.keyboard.press("Escape")

  await page.mouse.move(450, 100)
  await firePaste(page, [450, 100], { text: "https://www.youtube.com/watch?v=oBtKHwFBn0k" })
  const video = shapes(page, "youtube")
  await page.mouse.click(200, 550)
  await page.mouse.click(750, 300)
  await expect(video).toHaveAttribute("data-active", "false")
  await page.mouse.click(750, 300)
  await expect(video).toHaveAttribute("data-active", "true")
  await expect(board(page)).toBeVisible()
})
