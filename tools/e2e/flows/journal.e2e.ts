import { appAvailable } from "../src/env.ts"
import { journalTitle } from "../src/journal.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test("open app", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle("seqno")
})

test("journal visible", async ({ seqno }) => {
  await seqno.openDemoGraph()
  await expect(seqno.today.getByRole("heading", { level: 1 })).toHaveText(journalTitle(new Date()))
})

test("type in a block", async ({ page, seqno }) => {
  await seqno.openDemoGraph()
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.type(", hello from e2e")
  await expect(seqno.editor).toHaveText("Welcome to the seqno demo graph, hello from e2e")
  await page.keyboard.press("Escape")
  await expect(seqno.editor).toHaveCount(0)
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText(
    "Welcome to the seqno demo graph, hello from e2e",
  )
})

test("reload keeps text", async ({ page, seqno }) => {
  await seqno.openDemoGraph()
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.type(", survives reload")
  await expect(seqno.editor).toHaveText("Welcome to the seqno demo graph, survives reload")
  await seqno.saved()
  await page.reload()
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText(
    "Welcome to the seqno demo graph, survives reload",
  )
})

test("Enter splits a block and Tab indents the new one", async ({ page, seqno }) => {
  await seqno.openDemoGraph()
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(seqno.today.getByRole("treeitem").nth(1).getByRole("textbox")).toHaveText("")
  await page.keyboard.type("a new child")
  await page.keyboard.press("Tab")
  await expect(seqno.today.getByRole("treeitem", { level: 2 })).toHaveText(["a new child"])
  await page.keyboard.press("Escape")
  await expect(seqno.today.getByRole("treeitem")).toHaveText([
    "Welcome to the seqno demo graph",
    "a new child",
    "Open Getting started to see how pages link",
  ])
})
