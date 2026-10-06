import { appAvailable } from "../src/env.ts"
import { journalTitle } from "../src/journal.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test("open app", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle("seqno")
})

test("journal visible", async ({ page, seqno }) => {
  await page.goto("/")
  await expect(seqno.today.getByRole("heading", { level: 1 })).toHaveText(journalTitle(new Date()))
})

test("type in a block", async ({ page, seqno }) => {
  await page.goto("/")
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.type("hello from e2e")
  await expect(seqno.editor).toHaveText("hello from e2e")
  await page.keyboard.press("Escape")
  await expect(seqno.editor).toHaveCount(0)
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText("hello from e2e")
})

test("reload keeps text", async ({ page, seqno }) => {
  await page.goto("/")
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.type("survives reload")
  await expect(seqno.editor).toHaveText("survives reload")
  await page.reload()
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText("survives reload")
})
