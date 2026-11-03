import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, saved, test } from "../src/test.ts"
import { board, drag, newBoard, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

const mod = process.platform === "darwin" ? "Meta" : "Control"

const twoBoxes = async (page: Page) => {
  await newBoard(page)
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await page.keyboard.press("9")
  await drag(page, [520, 300], [620, 400])
  await expect(shapes(page, "box")).toHaveCount(2)
}

const left = (page: Page, nth: number) =>
  shapes(page, "box")
    .nth(nth)
    .evaluate((node) => (node instanceof HTMLElement ? node.style.left : ""))

const frame = (page: Page, kind: string) =>
  board(page).locator(`.wb-group-frame[data-kind="${kind}"]`)

test("Mod+G groups the selection: a click picks the group, a drag moves its shapes together, and Mod+Shift+G ungroups", async ({
  page,
}) => {
  await twoBoxes(page)
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.press(`${mod}+g`)
  await expect(frame(page, "selected")).toHaveCount(1)

  await page.mouse.click(900, 600)
  await expect(frame(page, "selected")).toHaveCount(0)
  await page.mouse.click(350, 350)
  await expect(frame(page, "selected")).toHaveCount(1)
  await expect(board(page).locator(".wb-handle")).toHaveCount(0)

  const before = [await left(page, 0), await left(page, 1)]
  await drag(page, [350, 350], [350, 450])
  await expect.poll(() => left(page, 0)).toBe(before[0])
  const tops = await shapes(page, "box").evaluateAll((nodes) =>
    nodes.map((node) => (node instanceof HTMLElement ? node.style.top : "")),
  )
  expect(new Set(tops).size).toBe(1)
  expect(tops[0]).not.toBe("")

  await saved(page)
  await page.reload()
  await expect(shapes(page, "box")).toHaveCount(2)
  await page.mouse.click(350, 450)
  await expect(frame(page, "selected")).toHaveCount(1)

  await page.keyboard.press(`${mod}+Shift+g`)
  await expect(frame(page, "selected")).toHaveCount(0)
  await expect(board(page).locator(".wb-outline:not([data-hover]):not(.wb-selection)")).toHaveCount(
    2,
  )
  await page.mouse.click(900, 600)
  await page.mouse.click(350, 450)
  await expect(board(page).locator(".wb-outline:not([data-hover]):not(.wb-selection)")).toHaveCount(
    1,
  )
})

test("the right-click menu groups and ungroups, the top shape of a selected group can be picked alone, and deleting the group deletes its shapes", async ({
  page,
}) => {
  await twoBoxes(page)
  await page.keyboard.press(`${mod}+a`)
  await page.mouse.click(350, 350, { button: "right" })
  await page.getByRole("menuitem", { name: "Group" }).click()
  await expect(frame(page, "selected")).toHaveCount(1)

  await page.mouse.click(570, 350)
  await expect(frame(page, "selected")).toHaveCount(0)
  await expect(frame(page, "member")).toHaveCount(1)

  await page.mouse.click(350, 350, { button: "right" })
  await expect(page.getByRole("menuitem", { name: "Ungroup" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.mouse.click(900, 600)
  await page.mouse.click(350, 350)
  await expect(frame(page, "selected")).toHaveCount(1)
  await page.keyboard.press("Delete")
  await expect(shapes(page, "box")).toHaveCount(0)
  await page.keyboard.press(`${mod}+z`)
  await expect(shapes(page, "box")).toHaveCount(2)
})
