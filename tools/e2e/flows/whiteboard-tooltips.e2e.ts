import { appAvailable } from "../src/env.ts"
import { expect, test } from "../src/test.ts"
import { board, newBoard } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

test("board buttons show Logseq's styled tooltip after 300ms, beside the tool bar and above the action bar", async ({
  page,
}) => {
  await newBoard(page)
  const tooltip = page.getByRole("tooltip")

  const undo = board(page).getByRole("button", { name: "Undo", exact: true })
  await expect(undo).not.toHaveAttribute("title")
  await undo.hover()
  const hovered = Date.now()
  await expect(tooltip).toBeHidden()
  await expect(tooltip).toBeVisible()
  expect(Date.now() - hovered).toBeGreaterThanOrEqual(250)
  await expect(tooltip).toContainText("Undo")
  await expect(tooltip.locator(".wb-tooltip-keys")).toHaveText("Mod+Z")
  await expect(tooltip).toHaveCSS("font-size", "15px")
  await expect(tooltip).toHaveCSS("padding", "10px 15px")
  const [above, undoBox] = await Promise.all([tooltip.boundingBox(), undo.boundingBox()])
  expect((above?.y ?? 0) + (above?.height ?? 0)).toBeCloseTo((undoBox?.y ?? 0) - 10, 0)

  const select = board(page).getByRole("button", { name: "Select", exact: true })
  await select.hover()
  await expect(tooltip).toContainText("Select")
  const [beside, selectBox] = await Promise.all([tooltip.boundingBox(), select.boundingBox()])
  expect((beside?.x ?? 0) + (beside?.width ?? 0)).toBeCloseTo((selectBox?.x ?? 0) - 10, 0)

  await page.mouse.down()
  await expect(tooltip).toBeHidden()
  await page.mouse.up()
  await page.waitForTimeout(500)
  await expect(tooltip).toBeHidden()

  await undo.hover()
  await expect(tooltip).toContainText("Undo")
  await page.mouse.move(400, 400)
  await expect(tooltip).toBeHidden()
})
