import type { Locator, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { serveMarketplace } from "../src/plugins.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const viewer = (page: Page) => page.locator(".seqno-pdf")
const menu = (page: Page) => viewer(page).locator(".seqno-pdf-menu")

const install = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()
  const dialog = page.getByRole("dialog", { name: "Plugins" })
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await dialog.press("Escape")
  await expect(dialog).toBeHidden()
}

const selectLine = async (page: Page, line: Locator) => {
  await line.scrollIntoViewIfNeeded()
  const box = await line.boundingBox()

  if (box === null) {
    throw new Error("the line has no box")
  }

  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 1, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, y, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ context, page, seqno }) => {
  await serveMarketplace(context)
  await context.route(/^https:\/\/translate\.googleapis\.com\//, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify([[["Una segunda línea de texto plano", "A second line of plain text"]]]),
    })
  })
  await seedOpfs(page, fixtureGraph("graphs/pdf-highlights"), ["graphs", "demo"])
  await seqno.openDemoGraph()
})

test("PDF Translator's highlight menu item translates the selected text in the viewer", async ({
  page,
}) => {
  await install(page, "logseq-pdf-translator")
  await page.keyboard.press("Control+k")
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("Reading")
  await page.getByRole("option").first().click()
  await page.getByRole("main").getByText("Paper.pdf", { exact: true }).click()

  const line = viewer(page).locator('.page[data-page-number="1"] .textLayer span', {
    hasText: "second line",
  })

  await expect(line).toBeVisible()
  await selectLine(page, line)
  await expect(menu(page).locator("li.seqno-pdf-item")).toHaveText(["Copy text", "Translate"])
  await menu(page).locator("li.seqno-pdf-item", { hasText: "Translate" }).click()
  await expect(page.locator(".pdf-translator-panel-content")).toHaveText(
    "Una segunda línea de texto plano",
  )
})
