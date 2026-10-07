import type { Browser, Page } from "@playwright/test"
import { seedOpfs } from "../src/opfs.ts"
import type { Theme } from "./theme.ts"

export interface SeqnoOptions {
  readonly baseURL: string
  readonly showcase: string
  readonly theme: Theme
  readonly leftSidebar: boolean
}

export const seqnoPage = async (browser: Browser, options: SeqnoOptions) => {
  const context = await browser.newContext({
    baseURL: options.baseURL,
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  await seedOpfs(page, options.showcase, ["graphs", "demo"])
  await page.evaluate(
    ({ theme, leftSidebar }) => {
      localStorage.setItem("seqno.theme", JSON.stringify(theme))
      localStorage.setItem("seqno.leftSidebar", JSON.stringify(leftSidebar))
    },
    { theme: options.theme, leftSidebar: options.leftSidebar },
  )
  return page
}

export const openSeqno = async (page: Page, path: string, blocks = true) => {
  await page.goto(path)
  const openDemo = page.getByRole("button", { name: "Open the demo graph" })
  const app = page.getByRole("main")
  await openDemo.or(app).first().waitFor({ timeout: 30_000 })
  if (await openDemo.isVisible()) await openDemo.click()
  await app.waitFor({ timeout: 30_000 })
  if (blocks) await page.getByRole("treeitem").first().waitFor({ timeout: 30_000 })
}

export const editBlock = async (page: Page, text: string) => {
  await page.getByRole("treeitem").filter({ hasText: text }).first().getByText(text).first().click()
  await page.getByRole("textbox").first().waitFor()
  await page.keyboard.press("End")
}

export const scrollToText = async (
  page: Page,
  text: string,
  offset: number,
  tries = 40,
): Promise<void> => {
  const target = page.getByRole("treeitem").filter({ hasText: text }).first()
  if ((await target.count()) > 0) {
    await target.evaluate((element, by) => {
      element.scrollIntoView({ block: "start", behavior: "instant" })
      let scroller = element.parentElement
      while (
        scroller !== null &&
        !(
          /auto|scroll/.test(getComputedStyle(scroller).overflowY) &&
          scroller.scrollHeight > scroller.clientHeight
        )
      ) {
        scroller = scroller.parentElement
      }
      ;(scroller ?? document.scrollingElement)?.scrollBy({ top: -by, behavior: "instant" })
    }, offset)
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".seqno-gap")].every((gap) => {
        const box = gap.getBoundingClientRect()
        return box.height === 0 || box.bottom <= 0 || box.top >= window.innerHeight
      }),
    )
    return
  }
  if (tries === 0) throw new Error(`no block with "${text}" after scrolling`)
  const tree = await page.getByRole("tree").first().boundingBox()
  const height = page.viewportSize()?.height ?? 900
  await page.mouse.move(
    (tree?.x ?? 720) + 200,
    Math.min(Math.max(tree?.y ?? 0, 0) + 200, height - 100),
  )
  await page.mouse.wheel(0, 600)
  await page.waitForFunction(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  return scrollToText(page, text, offset, tries - 1)
}
