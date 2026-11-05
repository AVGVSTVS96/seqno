import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, test } from "../src/test.ts"
import { drag, fireFiles, newBoard, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

const mod = process.platform === "darwin" ? "Meta" : "Control"

const boxes = async (page: Page) =>
  await shapes(page, "box").evaluateAll((nodes) =>
    nodes.map((node) =>
      node instanceof HTMLElement
        ? [
            Number(node.style.left.replace("px", "")),
            Number(node.style.top.replace("px", "")),
            node.offsetWidth,
            node.offsetHeight,
          ]
        : [],
    ),
  )

const draw = async (page: Page, from: readonly [number, number], to: readonly [number, number]) => {
  await page.keyboard.press("9")
  await drag(page, from, to)
}

const shiftClick = async (page: Page, at: readonly [number, number]) => {
  await page.keyboard.down("Shift")
  await page.mouse.click(at[0], at[1])
  await page.keyboard.up("Shift")
}

const menu = async (page: Page, at: readonly [number, number], name: string) => {
  await page.mouse.click(at[0], at[1], { button: "right" })
  await page.getByRole("menuitem", { name, exact: true }).click()
}

test("the right-click menu aligns, distributes and flips the selection, as Logseq's does", async ({
  page,
}) => {
  await newBoard(page)
  await draw(page, [200, 200], [280, 280])
  await draw(page, [400, 260], [520, 340])
  await draw(page, [700, 160], [760, 240])
  await expect(shapes(page, "box")).toHaveCount(3)
  const start = await boxes(page)
  await page.keyboard.press(`${mod}+a`)

  await menu(page, [240, 240], "Align top")
  const top = Math.min(...start.map(([, y = 0]) => y))
  await expect.poll(async () => (await boxes(page)).map(([, y]) => y)).toEqual([top, top, top])

  await menu(page, [240, 220], "Distribute horizontally")
  const spread = await boxes(page)

  const gaps = spread
    .toSorted(([a = 0], [b = 0]) => a - b)
    .flatMap(([x = 0], index, all) =>
      index === 0 ? [] : [x - ((all[index - 1]?.[0] ?? 0) + (all[index - 1]?.[2] ?? 0))],
    )

  expect(gaps[0]).toBeCloseTo(gaps[1] ?? 0, 5)
  expect(spread[0]?.[0]).toBe(start[0]?.[0])
  expect((spread[2]?.[0] ?? 0) + (spread[2]?.[2] ?? 0)).toBe(
    (start[2]?.[0] ?? 0) + (start[2]?.[2] ?? 0),
  )

  await menu(page, [240, 220], "Flip horizontally")
  const flipped = await boxes(page)
  const minX = Math.min(...spread.map(([x = 0]) => x))
  const maxX = Math.max(...spread.map(([x = 0, , w = 0]) => x + w))
  expect(flipped.map(([x]) => x)).toEqual(spread.map(([x = 0, , w = 0]) => minX + (maxX - (x + w))))

  await page.keyboard.press(`${mod}+z`)
  await expect.poll(async () => (await boxes(page)).map(([x]) => x)).toEqual(spread.map(([x]) => x))
})

test("Pack into rectangle packs the selection with 16px gaps, and a group aligns as one", async ({
  page,
}) => {
  await newBoard(page)
  await draw(page, [200, 200], [280, 280])
  await draw(page, [500, 400], [580, 480])
  await expect(shapes(page, "box")).toHaveCount(2)
  await page.keyboard.press(`${mod}+a`)
  await menu(page, [240, 240], "Pack into rectangle")
  await expect
    .poll(async () => {
      const [a = [], b = []] = await boxes(page)

      return Math.abs((b[0] ?? 0) - (a[0] ?? 0)) + Math.abs((b[1] ?? 0) - (a[1] ?? 0)) - (a[2] ?? 0)
    })
    .toBe(16)

  await draw(page, [100, 500], [180, 580])
  await expect(shapes(page, "box")).toHaveCount(3)
  const before = await boxes(page)
  await page.keyboard.press(`${mod}+a`)
  await shiftClick(page, [140, 540])
  await page.keyboard.press(`${mod}+g`)
  await shiftClick(page, [140, 540])
  await menu(page, [140, 540], "Align left")
  const after = await boxes(page)
  const shift = (after[0]?.[0] ?? 0) - (before[0]?.[0] ?? 0)
  expect((after[1]?.[0] ?? 0) - (before[1]?.[0] ?? 0)).toBe(shift)
  expect(shift).toBeLessThan(0)
  expect(after[2]?.[0]).toBe(before[2]?.[0])
})

test("files dropped together are packed into a rectangle with 16px gaps", async ({ page }) => {
  await newBoard(page)
  await fireFiles(
    page,
    "drop",
    [600, 400],
    [
      { name: "a.png", type: "image/png", drawn: [200, 200] },
      { name: "b.png", type: "image/png", drawn: [200, 200] },
    ],
  )
  const images = shapes(page, "image")
  await expect(images).toHaveCount(2)

  const [a, b] = await images.evaluateAll((nodes) =>
    nodes.map((node) =>
      node instanceof HTMLElement
        ? [Number(node.style.left.replace("px", "")), Number(node.style.top.replace("px", ""))]
        : [],
    ),
  )

  expect(Math.abs((b?.[0] ?? 0) - (a?.[0] ?? 0)) + Math.abs((b?.[1] ?? 0) - (a?.[1] ?? 0))).toBe(
    116,
  )
})
