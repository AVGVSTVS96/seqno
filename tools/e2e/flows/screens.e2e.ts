import { fileURLToPath } from "node:url"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(
  !appAvailable || process.env["SEQNO_SCREENS"] === undefined,
  "set SEQNO_SCREENS=1 to refresh docs/screens",
)

test.use({ viewport: { width: 1440, height: 900 } })

const screen = (name: string) =>
  fileURLToPath(new URL(`../../../docs/screens/${name}.png`, import.meta.url))

test("screenshots of the running app", async ({ page, seqno }) => {
  await seedOpfs(page, fixtureGraph("graphs/og-syntax-mix"), ["graphs", "demo"])
  await seqno.openDemoGraph()
  const journal = page.getByRole("article", { name: "Mar 9th, 2025", exact: true })
  await expect(journal.getByRole("treeitem").first()).toBeVisible()
  await page.screenshot({ path: screen("journal") })

  await page.goto("/page/tasks")
  await page.getByRole("button", { name: "Open the demo graph" }).click()
  await expect(page.getByRole("article", { name: "tasks", exact: true })).toBeVisible()
  await page.screenshot({ path: screen("page") })

  await page.getByRole("treeitem").filter({ hasText: "high priority item" }).click()
  await page.keyboard.press("End")
  await page.keyboard.type(" due [[Friday]]")
  await expect(seqno.editor).toHaveText("TODO [#A] high priority item due [[Friday]]")
  await page.screenshot({ path: screen("editing") })
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Search", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search" }).fill("item")
  await expect(
    page.getByRole("listbox", { name: "Nodes" }).getByRole("option").first(),
  ).toBeVisible()
  await page.screenshot({ path: screen("search") })
})
