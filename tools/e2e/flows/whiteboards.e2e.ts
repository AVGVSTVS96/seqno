import { appAvailable } from "../src/env.ts"
import { expect, saved, test } from "../src/test.ts"
import { board, drag, newBoard, rename, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

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
  await page.mouse.click(700, 600)
  await expect(shapes(page, "box")).toHaveText("Plan")
  await page.mouse.dblclick(400, 375)
  await page.getByRole("textbox", { name: "Label" }).press("End")
  await page.keyboard.type(" A")
  await page.keyboard.press("Escape")
  await expect(shapes(page, "box")).toHaveText("Plan A")

  await page.keyboard.press("o")
  await drag(page, [800, 300], [960, 420])
  await page.keyboard.press("7")
  await drag(page, [400, 375], [880, 360])
  const arrow = shapes(page, "line").locator("path").first()

  const ends = async () =>
    ((await arrow.getAttribute("d")) ?? "")
      .match(/-?\d+(\.\d+)?/gu)
      ?.map((n) => Math.round(Number(n)))

  await expect.poll(ends).toEqual([508, 325, 796, 318])

  await page.keyboard.press("1")
  await drag(page, [880, 380], [880, 580])
  await expect.poll(ends).toEqual([508, 369, 805, 487])

  await rename(page, "Garden plan")
  await saved(page)
  await page.reload()
  await expect(shapes(page, "box")).toHaveText("Plan A")
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
  await expect(page).toHaveURL(/\/page\/harvest%20log$/u)
  await expect(page.getByRole("region", { name: /Linked references/u })).toContainText("Beds")
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
  await page.mouse.click(800, 600)
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
  await expect(card).toContainText(/Edited /u)
  await expect(card.locator(".wb-shape[data-type='box']")).toHaveCount(1)
  await card.getByRole("checkbox", { name: "Select Compost bins" }).check()
  await page.getByRole("button", { name: "Delete 1 selected" }).click()
  await page.getByRole("button", { name: "Delete 1 whiteboard" }).click()
  await expect(page.getByRole("heading", { name: "All whiteboards · 0" })).toBeVisible()
})

test("a board embedded in a block shows its drawing, and the board counts the reference", async ({
  page,
  seqno,
}) => {
  await newBoard(page)
  await rename(page, "Raised beds")
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await expect(shapes(page, "box")).toHaveCount(1)
  await page.keyboard.press("g")
  await page.keyboard.press("j")
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await page.evaluate(async () => {
    await navigator.clipboard.writeText("{{embed [[Raised beds]]}}")
  })
  await seqno.today
    .getByRole("treeitem")
    .filter({ hasText: "Welcome to the seqno demo graph" })
    .click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.press("ControlOrMeta+v")
  await page.keyboard.press("Escape")
  const embed = seqno.today.locator(".wb-embed")
  await expect(embed.locator('.wb-shape[data-type="box"]')).toHaveCount(1)
  await seqno.today.getByRole("link", { name: "Raised beds" }).click()
  await expect(board(page)).toBeVisible()
  await page.getByRole("button", { name: "1 Reference" }).click()
  await expect(page.locator(".wb-references-panel")).toContainText("Raised beds")
})

test("copied shapes paste with their connector still bound, undo takes the paste back in one step, and cut moves them", async ({
  page,
}) => {
  await newBoard(page)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await page.keyboard.press("o")
  await drag(page, [600, 300], [700, 400])
  await page.keyboard.press("7")
  await drag(page, [350, 350], [650, 350])
  await expect(shapes(page, "line")).toHaveCount(1)
  await page.keyboard.press("1")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("ControlOrMeta+c")
  await page.mouse.move(400, 600)
  await page.keyboard.press("ControlOrMeta+v")
  await expect(shapes(page, "box")).toHaveCount(2)
  await expect(shapes(page, "ellipse")).toHaveCount(2)
  await expect(shapes(page, "line")).toHaveCount(2)

  const pastedArrow = shapes(page, "line").nth(1).locator("path").first()

  const ends = async () =>
    ((await pastedArrow.getAttribute("d")) ?? "")
      .match(/-?\d+(\.\d+)?/gu)
      ?.map((n) => Math.round(Number(n)))

  const before = await ends()
  await page.mouse.click(700, 700)
  const circle = shapes(page, "ellipse").nth(1)
  const box = await circle.boundingBox()

  if (box === null) {
    throw new Error("the pasted circle has no box")
  }

  await drag(
    page,
    [box.x + box.width / 2, box.y + box.height / 2],
    [box.x + box.width / 2, box.y + box.height / 2 + 160],
  )
  await expect.poll(ends).not.toEqual(before)

  await page.keyboard.press("ControlOrMeta+z")
  await page.keyboard.press("ControlOrMeta+z")
  await expect(shapes(page, "box")).toHaveCount(1)
  await expect(shapes(page, "line")).toHaveCount(1)

  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("ControlOrMeta+x")
  await expect(shapes(page, "box")).toHaveCount(0)
  await page.keyboard.press("ControlOrMeta+v")
  await expect(shapes(page, "box")).toHaveCount(1)
  await expect(shapes(page, "ellipse")).toHaveCount(1)
  await expect(shapes(page, "line")).toHaveCount(1)
})
