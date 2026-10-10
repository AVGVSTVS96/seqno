import type { Page } from "@playwright/test"
import { scrollToText } from "../design/seqno.ts"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const openShowcase = async (page: Page) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await openDemo(page, "/page/showcase")
  await scrollToText(page, "Live query", 100)
}

const groupNames = (query: ReturnType<Page["getByRole"]>) =>
  query
    .getByRole("region")
    .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")))

test("a query block lists its results by page and follows edits live", async ({ page }) => {
  await openShowcase(page)
  const query = page.getByRole("region", { name: "Live query" }).first()
  await expect(query.locator(".seqno-query-clause")).toHaveText(["task: NOW | DOING"])
  await expect(query.getByText("3 results")).toBeVisible()
  expect(await groupNames(query)).toEqual(["Oct 6th, 2026", "Showcase"])
  const showcase = query.getByRole("region", { name: "Showcase" })
  await expect(showcase.getByRole("navigation", { name: "Parent blocks" })).toHaveText(["Tasks"])
  await expect(showcase.getByRole("treeitem")).toHaveText([
    /DOING\s*Seal the gaps around the ridge beam/,
    /NOW\s*Water the seedlings before noon/,
  ])
  await showcase
    .getByRole("treeitem")
    .filter({ hasText: "Water the seedlings" })
    .getByRole("checkbox", { name: "Mark as done" })
    .click()
  await expect(query.getByText("2 results")).toBeVisible()
  await expect(showcase.getByRole("treeitem")).toHaveCount(1)
})

test("an and query draws its clauses in brackets, and No matched result when empty", async ({
  page,
  seqno,
}) => {
  await openShowcase(page)
  const query = page.getByRole("region", { name: "Live query" }).nth(1)
  await expect(query.locator(".seqno-query-group-clause")).toHaveText("(ANDtask: TODOpriority: A)")
  await query.getByRole("button", { name: "Edit the query" }).click()
  await expect(seqno.editor).toHaveText("{{query (and (task TODO) (priority A))}}")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText("{{query (and (task WAITING) (priority A))}}")
  await page.keyboard.press("Escape")
  await expect(query.getByText("No matched result")).toBeVisible()
  await expect(query.getByText(/^\d+ results?$/)).toHaveCount(0)
})
