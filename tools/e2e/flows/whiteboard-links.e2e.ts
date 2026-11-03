import { appAvailable } from "../src/env.ts"
import { expect, test } from "../src/test.ts"
import { board, drag, newBoard, rename, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

test("a shape's Link button links it to a page: Quick Links show it on hover, and the page lists the board in its linked references", async ({
  page,
}) => {
  await newBoard(page)
  await rename(page, "Bed links")
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  const bar = page.getByRole("toolbar", { name: "Shape style" })
  await bar.getByRole("button", { name: "Link", exact: true }).click()
  await expect(page.getByText("Link to any page or block")).toBeVisible()
  const search = page.getByRole("combobox", { name: "Search for a page or block to link" })
  await search.fill("Harvest log")
  await page.getByRole("option", { name: "Harvest log", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remove link" })).toBeVisible()
  await expect(search).toHaveCount(0)
  await expect(bar.getByRole("button", { name: "Link", exact: true })).toHaveText("1")

  await page.keyboard.press("Escape")
  await page.mouse.click(800, 600)
  await page.mouse.move(350, 350)
  const quick = board(page).getByTitle("Shape Quick Links")
  await expect(quick).toContainText("Harvest log")
  await page.mouse.move(350, 420)
  await quick.getByRole("button", { name: /Harvest log/ }).dispatchEvent("pointerdown")
  await expect(page).toHaveURL(/\/page\/harvest%20log$/)
  await expect(page.getByRole("region", { name: /Linked references/ })).toContainText("Bed links")
})

test("Mod+Shift+V links the selected shape to a copied shape, which then shows a backlinks count", async ({
  page,
}) => {
  await newBoard(page)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await page.keyboard.press("o")
  await drag(page, [600, 300], [700, 400])
  await page.mouse.click(350, 350)
  await page.keyboard.press("ControlOrMeta+c")
  await page.mouse.click(650, 350)
  await page.keyboard.press("ControlOrMeta+Shift+v")
  await expect(shapes(page, "box")).toHaveCount(1)
  const bar = page.getByRole("toolbar", { name: "Shape style" })
  await expect(bar.getByRole("button", { name: "Link", exact: true })).toHaveText("1")

  await page.mouse.click(350, 350)
  const badge = board(page).getByRole("button", { name: "1 references" })
  await expect(badge).toBeVisible()
  await badge.click()
  await expect(board(page).locator(".wb-backlinks-popover")).toBeVisible()
})
