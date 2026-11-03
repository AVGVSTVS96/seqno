import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { serveMarketplace } from "../src/plugins.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const welcome = "Welcome to the seqno demo graph"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

const install = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()
  const dialog = page.getByRole("dialog", { name: "Plugins" })
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")
}

test("Assets plus lists the graph's assets through logseq.Assets and links the one picked", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Assets plus")
  const row = page.getByRole("main").getByRole("treeitem").filter({ hasText: welcome }).first()
  await row.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" /upload")
  const chooser = page.waitForEvent("filechooser")
  await page.keyboard.press("Enter")
  await (await chooser).setFiles({ name: "harvest.png", mimeType: "image/png", buffer: png })
  await expect(seqno.editor).toHaveText(/!\[harvest\.png\]/)
  await page.keyboard.press("Enter")
  await page.keyboard.type("/Insert a local asset file")
  await page.keyboard.press("Enter")
  const picker = page.frameLocator("#logseq-assets-plus_iframe")
  await picker.getByPlaceholder("Search local assets for current graph").fill("harvest")
  await expect(picker.getByText(/^harvest_\d{13}_0/)).toBeVisible()
  await picker.getByPlaceholder("Search local assets for current graph").press("Enter")
  await expect(seqno.editor).toHaveText(
    /^!\[harvest_\d{13}_0\.png\]\(assets\/harvest_\d{13}_0\.png\)$/,
  )
  await seqno.editor.press("Escape")
  await expect(
    page.getByRole("main").getByRole("img", { name: /^harvest_\d{13}_0\.png$/ }),
  ).toHaveJSProperty("naturalWidth", 1)
})
