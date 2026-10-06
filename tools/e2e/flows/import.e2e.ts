import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const journalOf = (page: import("@playwright/test").Page) =>
  page.getByRole("article", { name: "Mar 9th, 2025", exact: true })

test.beforeEach(async ({ page, seqno }) => {
  await seedOpfs(page, fixtureGraph("graphs/og-syntax-mix"), ["graphs", "demo"])
  await seqno.openDemoGraph()
})

test("an imported journal renders", async ({ page }) => {
  await expect(journalOf(page).getByRole("treeitem")).toHaveText([
    "journal links to project/Alpha and Alpha Project",
    "journal uses a namespaced tag #project/Alpha",
    /^time-tracked task/,
  ])
})

test("a page link opens the page", async ({ page }) => {
  await journalOf(page).getByRole("link", { name: "project/Alpha" }).first().click()
  const alpha = page.getByRole("article", { name: "project/Alpha", exact: true })
  await expect(alpha).toBeVisible()
  await expect(page).toHaveURL(/\/page\/project%2Falpha$/)
})

test("an edit to an imported block survives a reload", async ({ page, seqno }) => {
  const link = journalOf(page).getByRole("link", { name: "project/Alpha" }).first()
  const box = await link.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click((box?.x ?? 0) - 12, (box?.y ?? 0) + (box?.height ?? 0) / 2)
  await page.keyboard.press("End")
  await page.keyboard.type(" (edited)")
  await expect(seqno.editor).toHaveText(
    "journal links to [[project/Alpha]] and [[Alpha Project]] (edited)",
  )
  await seqno.saved()
  await page.reload()
  await page.getByRole("button", { name: "Open the demo graph" }).click()
  await expect(journalOf(page).getByRole("treeitem").first()).toHaveText(
    "journal links to project/Alpha and Alpha Project (edited)",
  )
})

test("search finds an imported block", async ({ page }) => {
  await page.getByRole("link", { name: "Search" }).click()
  await page.getByRole("searchbox", { name: "Search" }).fill("voice")
  await expect(page.getByRole("list", { name: "Blocks" }).getByRole("listitem")).toHaveText([
    "tasksI recorded a [[voice note]].",
  ])
})
