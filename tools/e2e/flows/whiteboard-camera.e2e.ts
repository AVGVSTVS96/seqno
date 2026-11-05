import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, test } from "../src/test.ts"
import { board, drag, newBoard } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

const zoomLabel = (page: Page) => page.getByRole("button", { name: "Zoom menu" })

const framesWhile = async (page: Page, act: () => Promise<void>) => {
  const frames = page.evaluate(
    async () =>
      await new Promise<readonly string[]>((resolve) => {
        const seen: string[] = []
        const start = performance.now()

        const sample = () => {
          const world = document.querySelector<HTMLElement>(".wb-world")
          const now = world?.style.transform ?? ""

          if (seen.at(-1) !== now) {
            seen.push(now)
          }

          if (performance.now() - start < 600) {
            requestAnimationFrame(sample)
          } else {
            resolve(seen)
          }
        }

        requestAnimationFrame(sample)
      }),
  )

  await act()

  return await frames
}

test("zoom in glides over several frames to 125%, and the board keeps its camera when you come back", async ({
  page,
}) => {
  await newBoard(page)
  await page.keyboard.press("9")
  await drag(page, [300, 300], [400, 400])
  await page.mouse.click(800, 600)
  const frames = await framesWhile(page, async () => {
    await page.keyboard.press("Shift+Equal")
  })
  await expect(zoomLabel(page)).toHaveText("125%")
  expect(frames.length).toBeGreaterThan(2)
  expect(frames.at(-1)).toMatch(/^scale\(1\.25\)/)

  const url = page.url()
  await page.keyboard.press("g")
  await page.keyboard.press("j")
  await expect(page).not.toHaveURL(url)
  await page.goto(url)
  await expect(board(page)).toBeVisible()
  await expect(zoomLabel(page)).toHaveText("125%")
})

test("Alt+wheel does nothing and a plain wheel pans at 0.8 of the wheel, as in Logseq", async ({
  page,
}) => {
  await newBoard(page)
  await page.mouse.move(600, 400)
  const world = page.locator(".wb-world")
  await page.keyboard.down("Alt")
  await page.mouse.wheel(0, 100)
  await page.keyboard.up("Alt")
  await expect(zoomLabel(page)).toHaveText("100%")
  await expect(world).toHaveAttribute("style", /translate\(0px, 0px\)/)
  await page.mouse.wheel(0, 100)
  await expect(world).toHaveAttribute("style", /translate\(0px, -80px\)/)
})
