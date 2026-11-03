import type { Locator } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { journalTitle } from "../src/journal.ts"
import { opfsFile } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const groupNames = (query: Locator) =>
  query
    .getByRole("region")
    .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")))

const nov3 = journalTitle(new Date(2026, 10, 3))

test("the graph switcher opens the developer graph, and Contents is its hub", async ({ page }) => {
  await openDemo(page)
  await page.getByRole("button", { name: "Toggle left sidebar" }).click()
  await page.getByRole("button", { name: "Getting started" }).click()
  await page.getByRole("menuitemradio", { name: "Developer graph" }).click()
  const latest = page.getByRole("article", { name: nov3, exact: true })
  await expect(latest.getByRole("treeitem").first()).toHaveText(
    /NOW\s*seqno: whiteboards, flashcards and plugins, the Logseq features still to build projects\/seqno/,
  )
  await page.keyboard.press("t")
  await page.keyboard.press("r")
  const contents = page.getByRole("complementary", { name: "Right sidebar" })
  await expect(contents.getByRole("link", { name: "About this graph" })).toBeVisible()
  await expect(contents.getByRole("link", { name: "projects/autofork" })).toBeVisible()
  const now = contents.getByRole("region", { name: "Live query" })
  await expect(now.getByText("2 results")).toBeVisible()
  expect(await groupNames(now)).toEqual([nov3])
})

test("a query lists the decisions tagged with a project, but not its own block", async ({
  page,
}) => {
  await openDemo(page, "/page/projects%2Fseqno", "Developer graph")
  const decisions = page.getByRole("region", { name: "Live query" }).first()
  await expect(decisions.locator(".seqno-query-group-clause")).toHaveText(
    "(AND[[decision]][[seqno]])",
  )
  await expect(decisions.getByText(/^\d+ results$/)).toBeVisible()
  const days = await groupNames(decisions)
  expect(days[0]).toBe(nov3)
  expect(days).toContain(journalTitle(new Date(2026, 9, 6)))
})

test("a new project's page shows its decisions, and the one he changed his mind on", async ({
  page,
}) => {
  await openDemo(page, "/page/projects%2Fautofork", "Developer graph")
  const main = page.getByRole("main")
  await expect(
    main.getByText("one agent run fixes the patches when verify fails").first(),
  ).toBeVisible()
  const decisions = main.getByRole("region", { name: "Live query" }).first()
  const days = await groupNames(decisions)
  expect(days).toContain(journalTitle(new Date(2026, 9, 29)))
  expect(days).toContain(journalTitle(new Date(2026, 9, 12)))
})

test("systems of power reads in six places, each with its own days", async ({ page }) => {
  await openDemo(page, "/page/systems%20of%20power", "Developer graph")
  const main = page.getByRole("main")
  for (const heading of [
    "who gets power, and what it does to them",
    "designing the rules",
    "how republics die",
    "systems that correct themselves",
    "in fiction",
    "in software",
  ])
    await expect(main.getByRole("heading", { name: heading })).toBeVisible()
  await expect(main.getByText("positions of power are inherently corrupting").first()).toBeVisible()
})

test("a namespaced page's edit reaches its triple-lowbar file, and every demo file matches its page", async ({
  page,
}) => {
  await openDemo(page)
  await page.keyboard.press("Control+k")
  await page.getByRole("searchbox", { name: "Search" }).fill("projects/Cold frame")
  await expect(page.locator("[role=option][data-kind]").first()).toHaveText("projects/Cold frame")
  await page.keyboard.press("Enter")
  const frame = page.getByRole("article", { name: "projects/Cold frame", exact: true })
  await frame.getByText("Ours uses an old window.").click()
  await page.keyboard.press("End")
  await page.keyboard.type(" It faces south.")
  await page.keyboard.press("Escape")
  await expect
    .poll(
      async () =>
        (await opfsFile(page, ["graphs", "demo"], "pages/projects___Cold frame.md"))?.text ?? "",
      { timeout: 15_000 },
    )
    .toContain(" It faces south.")
  await expect(page.getByText("seqno didn't write")).toHaveCount(0)
})
