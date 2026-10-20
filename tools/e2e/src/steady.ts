import type { Page } from "@playwright/test"
import { expect } from "./test.ts"

export interface Crawl {
  readonly checked: number
  readonly moved: ReadonlyArray<string>
}

export const crawl = (page: Page, px: number, distance = Number.POSITIVE_INFINITY) =>
  page.getByRole("main").evaluate(
    async (scroller, [step, far]): Promise<Crawl> => {
      const box = scroller.getBoundingClientRect()
      const painted = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => {
            const observer = new ResizeObserver(() => {
              observer.disconnect()
              resolve(null)
            })
            observer.observe(scroller)
          }),
        )
      const topRow = () =>
        [...scroller.querySelectorAll("[role=treeitem]")].find(
          (row) => row.getBoundingClientRect().top >= box.top,
        )
      const moved: Array<string> = []
      let checked = 0
      let anchor = topRow()
      let top = anchor?.getBoundingClientRect().top ?? 0
      let travelled = 0
      while (travelled < far) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const before = scroller.scrollTop
        scroller.scrollTop += step
        const requested = scroller.scrollTop - before
        if (requested === 0) break
        travelled += Math.abs(requested)
        await painted()
        if (anchor?.isConnected === true) {
          checked++
          const by = Math.round(anchor.getBoundingClientRect().top - top + requested)
          if (by !== 0) moved.push(`${anchor.textContent?.slice(0, 12)} moved ${by}px`)
        }
        anchor = topRow()
        top = anchor?.getBoundingClientRect().top ?? 0
      }
      return { checked, moved }
    },
    [px, distance] as const,
  )

export const topRow = (page: Page) =>
  page.getByRole("main").evaluate((scroller) => {
    const box = scroller.getBoundingClientRect()
    const row = [...scroller.querySelectorAll("[role=treeitem]")].find(
      (shown) => shown.getBoundingClientRect().top >= box.top,
    )
    return `${row?.textContent?.slice(0, 12)} at ${Math.round((row?.getBoundingClientRect().top ?? 0) - box.top)}px`
  })

export const topRowsOver = (page: Page, frames: number) =>
  page.getByRole("main").evaluate(async (scroller, count) => {
    const box = scroller.getBoundingClientRect()
    const seen: Array<string> = []
    for (let frame = 0; frame < count; frame++) {
      await new Promise((resolve) =>
        requestAnimationFrame(() => {
          const observer = new ResizeObserver(() => {
            observer.disconnect()
            resolve(null)
          })
          observer.observe(scroller)
        }),
      )
      const row = [...scroller.querySelectorAll("[role=treeitem]")].find(
        (shown) => shown.getBoundingClientRect().top >= box.top,
      )
      const now = `${row?.textContent?.slice(0, 12)} at ${Math.round((row?.getBoundingClientRect().top ?? 0) - box.top)}px`
      if (seen.at(-1) !== now) seen.push(now)
    }
    return seen
  }, frames)

export const awayAndBack = async (
  page: Page,
  away: () => Promise<unknown> = async () => undefined,
) => {
  await page.keyboard.press("g")
  await page.keyboard.press("a")
  await expect(page.getByRole("table", { name: "All pages" })).toBeVisible()
  await away()
  await page.waitForTimeout(300)
  await page.goBack()
}

export const landsOn = async (page: Page, row: string) => {
  await expect.poll(() => topRow(page)).toBe(row)
  expect(await topRowsOver(page, 60)).toEqual([row])
}
