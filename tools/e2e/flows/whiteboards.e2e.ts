import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, openDemo, saved, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const board = (page: Page) => page.getByRole("application", { name: /^Whiteboard / })

const shapes = (page: Page, type: string) => board(page).locator(`.wb-shape[data-type="${type}"]`)

const drag = async (page: Page, from: readonly [number, number], to: readonly [number, number]) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 4 })
  await page.mouse.up()
}

const newBoard = async (page: Page) => {
  await openDemo(page, "/")
  await page.keyboard.press("g")
  await page.keyboard.press("w")
  await expect(page).toHaveURL(/\/whiteboards$/)
  await expect(page).toHaveTitle("Whiteboards")
  await page.getByRole("button", { name: "New whiteboard" }).click()
  await expect(board(page)).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Whiteboard title" })).toHaveAttribute(
    "placeholder",
    "Untitled",
  )
}

const rename = async (page: Page, title: string) => {
  const input = page.getByRole("textbox", { name: "Whiteboard title" })
  await input.fill(title)
  await input.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/page/${encodeURIComponent(title.toLowerCase())}$`))
}

test("draws a labeled rectangle connected to a circle, and the arrow follows the circle when it moves", async ({
  page,
}) => {
  await newBoard(page)
  await page.keyboard.press("9")
  await drag(page, [300, 300], [500, 450])
  await expect(shapes(page, "box")).toHaveCount(1)
  await expect(shapes(page, "box")).toHaveCSS("width", "200px")
  await expect(shapes(page, "box")).toHaveCSS("height", "144px")

  await page.mouse.dblclick(400, 375)
  await page.getByRole("textbox", { name: "Label" }).fill("Plan")
  await page.keyboard.press("Escape")
  await expect(shapes(page, "box")).toHaveText("Plan")

  await page.keyboard.press("o")
  await drag(page, [800, 300], [960, 420])
  await page.keyboard.press("7")
  await drag(page, [400, 375], [880, 360])
  const arrow = shapes(page, "line").locator("path").first()
  const ends = async () =>
    ((await arrow.getAttribute("d")) ?? "")
      .match(/-?\d+(\.\d+)?/g)
      ?.map((n) => Math.round(Number(n)))
  await expect.poll(ends).toEqual([508, 325, 796, 318])

  await page.keyboard.press("1")
  await drag(page, [880, 380], [880, 580])
  await expect.poll(ends).toEqual([508, 369, 805, 487])

  await rename(page, "Garden plan")
  await saved(page)
  await page.reload()
  await expect(shapes(page, "box")).toHaveText("Plan")
  await expect(shapes(page, "ellipse")).toHaveCount(1)
  await expect(shapes(page, "line")).toHaveCount(1)
  await expect(page.getByRole("textbox", { name: "Whiteboard title" })).toHaveValue("Garden plan")
})

test("a page placed on the board shows it live, and the board shows up in that page's linked references", async ({
  page,
}) => {
  await newBoard(page)
  await rename(page, "Beds")
  await page.mouse.dblclick(500, 300)
  const search = page.getByRole("combobox", { name: "Create or search your graph" })
  await expect(page.getByRole("option", { name: "New block" })).toBeVisible()
  await search.fill("Harvest log")
  await page.getByRole("option", { name: "Harvest log", exact: true }).click()
  const portal = shapes(page, "portal")
  await expect(portal.getByRole("link", { name: "Harvest log" })).toBeVisible()
  await expect(portal.getByRole("treeitem").first()).toBeVisible()

  await portal.getByRole("link", { name: "Harvest log" }).click()
  await expect(page).toHaveURL(/\/page\/harvest%20log$/)
  await expect(page.getByRole("region", { name: /Linked references/ })).toContainText("Beds")
})

test("a new block from the board's search is an ordinary block, edited in place on the board", async ({
  page,
}) => {
  await newBoard(page)
  await page.keyboard.press("3")
  await page.mouse.click(500, 300)
  await page.getByRole("combobox", { name: "Create or search your graph" }).fill("Water the beans")
  await page.getByRole("option", { name: "New block: Water the beans" }).click()
  const portal = shapes(page, "portal")
  await expect(portal.getByRole("treeitem")).toContainText("Water the beans")
  await expect(portal.getByRole("treeitem").getByRole("textbox")).toBeFocused()
})

test("undo takes a new shape back and redo brings it again; Delete removes the selection", async ({
  page,
}) => {
  await newBoard(page)
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await expect(shapes(page, "box")).toHaveCount(1)
  await page.keyboard.press("ControlOrMeta+z")
  await expect(shapes(page, "box")).toHaveCount(0)
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(shapes(page, "box")).toHaveCount(1)
  await page.mouse.click(350, 350)
  await page.keyboard.press("Delete")
  await expect(shapes(page, "box")).toHaveCount(0)
})

test("the Whiteboards list shows each board as a card and deletes the ticked ones", async ({
  page,
}) => {
  await newBoard(page)
  await rename(page, "Compost bins")
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await saved(page)
  await page.keyboard.press("g")
  await page.keyboard.press("w")
  await expect(page.getByRole("heading", { name: "All whiteboards · 1" })).toBeVisible()
  const card = page.getByRole("link", { name: "Compost bins" })
  await expect(card).toContainText(/Edited /)
  await expect(card.locator(".wb-shape[data-type='box']")).toHaveCount(1)
  await card.getByRole("checkbox", { name: "Select Compost bins" }).check()
  await page.getByRole("button", { name: "Delete 1 selected" }).click()
  await page.getByRole("button", { name: "Delete 1 whiteboard" }).click()
  await expect(page.getByRole("heading", { name: "All whiteboards · 0" })).toBeVisible()
})
