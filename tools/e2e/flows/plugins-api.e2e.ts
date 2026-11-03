import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { serveMarketplace } from "../src/plugins.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const openPlugins = async (page: Page) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()
  return page.getByRole("dialog", { name: "Plugins" })
}

const install = async (page: Page, name: string) => {
  const dialog = await openPlugins(page)
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")
}

test("Word count shows how many words are selected in a block, next to the selection", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "logseq-wordcount-plugin")
  const dialog = await openPlugins(page)
  await dialog.getByRole("button", { name: "logseq-wordcount-plugin settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  const count = settings.getByRole("switch", { name: "Count Highlighted Text" })
  await count.click()
  await expect(count).toHaveAttribute("aria-checked", "true")
  await page.reload()
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  const [start, end] = await seqno.editor.evaluate((editor) => {
    const line = editor.querySelector(".cm-line")?.firstChild ?? editor
    const at = (offset: number) => {
      const range = document.createRange()
      range.setStart(line, offset)
      range.setEnd(line, offset + 1)
      const rect = range.getBoundingClientRect()
      return { x: rect.left + 1, y: rect.top + rect.height / 2 }
    }
    return [at(0), at("Rain all morning".length - 1)]
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const point = { x: Math.round(end.x + 6), y: Math.round(end.y) }
  await page.mouse.move(point.x, point.y, { steps: 5 })
  await page.mouse.up()
  const float = page.locator("#logseq-wordcount-plugin--logseq-wordcount-plugin-countselection")
  await expect(float).toHaveText("Words: 3")
  const box = await float
    .locator("xpath=ancestor::*[contains(@class, 'lsp-ui-float-container')]")
    .boundingBox()
  expect(box === null ? null : [Math.round(box.x), Math.round(box.y)]).toEqual([point.x, point.y])
  await page.mouse.click(10, 10)
  await expect(page.locator("#logseq-wordcount-plugin_lsp_main")).not.toHaveClass(/visible/)
})
