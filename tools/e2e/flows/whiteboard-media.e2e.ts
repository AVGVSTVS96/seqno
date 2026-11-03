import { appAvailable } from "../src/env.ts"
import { opfsFiles } from "../src/opfs.ts"
import { expect, saved, test } from "../src/test.ts"
import { board, drag, fireFiles, newBoard, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

test("an image dropped on a board is saved in assets/ and lands at half its size where it fell", async ({
  page,
}) => {
  await newBoard(page)
  await fireFiles(
    page,
    "drop",
    [600, 400],
    [{ name: "beds.png", type: "image/png", drawn: [400, 240] }],
  )
  const image = shapes(page, "image")
  await expect(image).toHaveCount(1)
  await expect(image).toHaveCSS("width", "200px")
  await expect(image).toHaveCSS("height", "120px")
  const box = await image.boundingBox()
  expect([Math.round((box?.x ?? 0) + 100), Math.round((box?.y ?? 0) + 60)]).toEqual([600, 400])
  await expect
    .poll(() =>
      image
        .locator("img")
        .evaluate((node) => (node instanceof HTMLImageElement ? node.naturalWidth : 0)),
    )
    .toBe(400)
  const assets = Object.keys(await opfsFiles(page, ["graphs", "demo", "assets"]))
  expect(assets.filter((name) => /^beds_\d+_0\.png$/.test(name))).toHaveLength(1)

  await saved(page)
  await page.reload()
  await expect(image).toHaveCSS("width", "200px")
  await expect(image.locator("img")).toBeVisible()
})

test("an image resizes with its aspect ratio kept, and pasting an image file places it at the pointer", async ({
  page,
}) => {
  await newBoard(page)
  await fireFiles(
    page,
    "drop",
    [500, 400],
    [{ name: "plot.png", type: "image/png", drawn: [200, 100] }],
  )
  const image = shapes(page, "image")
  await expect(image).toHaveCSS("width", "100px")
  await drag(page, [550, 400], [650, 400])
  const ratio = () =>
    image.evaluate((node) =>
      node instanceof HTMLElement ? [node.offsetWidth, node.offsetWidth / node.offsetHeight] : [],
    )
  await expect.poll(async () => (await ratio())[1]).toBe(2)
  expect((await ratio())[0]).toBeGreaterThan(190)

  await page.mouse.click(900, 600)
  await page.mouse.move(800, 250)
  await fireFiles(
    page,
    "paste",
    [800, 250],
    [{ name: "image.png", type: "image/png", drawn: [80, 40] }],
  )
  await expect(image).toHaveCount(2)
  const pasted = await image.nth(1).boundingBox()
  expect([Math.round((pasted?.x ?? 0) + 20), Math.round((pasted?.y ?? 0) + 10)]).toEqual([800, 250])
})

test("a file dropped while one shape is selected comes in linked to it by a connector", async ({
  page,
}) => {
  await newBoard(page)
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await expect(shapes(page, "box")).toHaveCount(1)
  await fireFiles(
    page,
    "drop",
    [700, 350],
    [{ name: "seedlings.png", type: "image/png", drawn: [160, 160] }],
  )
  await expect(shapes(page, "image")).toHaveCount(1)
  await expect(shapes(page, "line")).toHaveCount(1)
  await expect(board(page).locator(".wb-outline:not([data-hover])")).toHaveCount(1)
})
