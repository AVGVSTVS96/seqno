import type { Locator } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { journalTitle } from "../src/journal.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const groupNames = (query: Locator) =>
  query
    .getByRole("region")
    .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")))

const daysAgo = (days: number) => {
  const today = new Date()
  return journalTitle(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days))
}

test("the graph switcher opens the developer graph, and Contents is its hub", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Toggle left sidebar" }).click()
  await page.getByRole("button", { name: "Getting started" }).click()
  await page.getByRole("menuitem", { name: "Developer graph" }).click()
  const today = page.getByRole("article", { name: journalTitle(new Date()), exact: true })
  await expect(today.getByRole("treeitem").first()).toHaveText(
    /NOW\s*seqno lazy open, first step of hardening projects\/seqno/,
  )
  await page.keyboard.press("t")
  await page.keyboard.press("r")
  const contents = page.getByRole("complementary", { name: "Right sidebar" })
  await expect(contents.getByRole("link", { name: "About this graph" })).toBeVisible()
  const now = contents.getByRole("region", { name: "Live query" })
  await expect(now.getByText("2 results")).toBeVisible()
  expect(await groupNames(now)).toEqual([daysAgo(0), daysAgo(6)])
})

test("a query lists the decisions tagged with a project, but not its own block", async ({
  page,
}) => {
  await page.goto("/graphs")
  await page.getByRole("button", { name: "Open Developer graph" }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto("/page/projects%2Fseqno")
  const decisions = page.getByRole("region", { name: "Live query" }).first()
  await expect(decisions.locator(".seqno-query-group-clause")).toHaveText(
    "(AND[[decision]][[seqno]])",
  )
  await expect(decisions.getByText("13 results")).toBeVisible()
  expect(await groupNames(decisions)).toEqual([daysAgo(11), daysAgo(13), daysAgo(14), daysAgo(16)])
})
