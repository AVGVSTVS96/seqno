import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, saved, test } from "../src/test.ts"
import { board, drag, newBoard, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

const turn = async (page: Page) =>
  await shapes(page, "box").evaluate((node) =>
    node instanceof HTMLElement ? node.style.transform : "",
  )

const radiansOf = (transform: string) => Number.parseFloat(transform.replace("rotate(", ""))

const drawBox = async (page: Page) => {
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await expect(shapes(page, "box")).toHaveCount(1)
  await page.mouse.click(800, 600)
  await page.mouse.click(350, 350)
}

test("dragging just outside a selected shape's corner rotates it about its center, with Logseq's rotate cursor", async ({
  page,
}) => {
  await newBoard(page)
  await drawBox(page)
  const target = board(page).locator('[data-handle="rotate-top-right"]')
  await expect(target).toHaveCSS("cursor", /svg\+xml.*pointer/)
  const box = await shapes(page, "box").boundingBox()
  const [cx, cy] = [(box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2]
  await page.mouse.move(406, 294)
  await page.mouse.down()
  await page.mouse.move(406, 288)
  await page.mouse.move(406, 406, { steps: 4 })
  await page.mouse.up()
  const expected = Math.atan2(406 - cy, 406 - cx) - Math.atan2(288 - cy, 406 - cx)
  await expect.poll(async () => Math.abs(radiansOf(await turn(page)) - expected)).toBeLessThan(1e-4)
  await expect(board(page).locator(".wb-frame")).toHaveCSS("rotate", /^9\d(\.\d+)?deg$/)

  await saved(page)
  await page.reload()
  await expect.poll(async () => Math.abs(radiansOf(await turn(page)) - expected)).toBeLessThan(1e-4)
})

test("Shift snaps the turn to 15 degrees, and Escape mid-drag puts the shape back", async ({
  page,
}) => {
  await newBoard(page)
  await drawBox(page)
  await page.mouse.move(406, 294)
  await page.mouse.down()
  await page.mouse.move(420, 330, { steps: 4 })
  await page.keyboard.press("Escape")
  await page.mouse.up()
  expect(await turn(page)).toBe("")

  await page.keyboard.down("Shift")
  await drag(page, [406, 294], [430, 320])
  await page.keyboard.up("Shift")
  await expect
    .poll(async () => {
      const radians = radiansOf(await turn(page))

      return Math.abs(radians / (Math.PI / 12) - Math.round(radians / (Math.PI / 12))) < 1e-4
    })
    .toBe(true)
  expect(await turn(page)).not.toBe("")
})
