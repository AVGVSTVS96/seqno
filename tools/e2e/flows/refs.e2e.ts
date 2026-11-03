import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ page, seqno }) => {
  await seedOpfs(page, fixtureGraph("graphs/forward-block-refs"), ["graphs", "demo"])
  await seqno.openDemoGraph()
})

const openPage = async (page: Page, name: string) => {
  await page.keyboard.press("Control+k")
  await page.getByRole("searchbox", { name: "Search" }).fill(name)
  await expect(page.getByRole("option").first()).toHaveText(name)
  await page.keyboard.press("Enter")
  return page.getByRole("article", { name, exact: true })
}

test("refs and embeds of blocks on another page that carry a Logseq id:: show those blocks", async ({
  page,
}) => {
  const source = await openPage(page, "a source")
  await expect(source.getByRole("treeitem")).toHaveText([
    /^forward ref to a later file forward target top level/,
    "nested forward ref forward target nested",
    /^ref inside a property value/,
  ])
  await expect(source.locator(".is-missing")).toHaveCount(0)
  const journal = page.getByRole("article", { name: "Jan 1st, 2025", exact: true })
  await openPage(page, "Jan 1st, 2025")
  await expect(journal.getByRole("treeitem").first()).toContainText("forward target top level")
  await expect(journal.getByText("forward target deep")).toBeVisible()
  await expect(journal.locator(".is-missing")).toHaveCount(0)
})

test("a block ref picked from (( suggestions writes the block's Logseq id", async ({
  page,
  seqno,
}) => {
  const source = await openPage(page, "a source")
  await source.getByText("nested forward ref", { exact: true }).click()
  await page.keyboard.press("End")
  await page.keyboard.type(" ((forward target deep")
  await expect(page.getByRole("option", { selected: true })).toContainText("forward target deep")
  await page.keyboard.press("Enter")
  await expect(seqno.editor).toHaveText(
    "nested forward ref ((66666666-6666-4666-8666-666666666602)) ((66666666-6666-4666-8666-666666666603))",
  )
})

test("Export page writes the text of blocks on another page that its refs name by Logseq id", async ({
  page,
}) => {
  await openPage(page, "a source")
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Export page" }).click()
  const text = page
    .getByRole("dialog", { name: "Export" })
    .getByRole("textbox", { name: "Exported text" })
  await expect(text).toHaveValue(
    [
      "- forward ref to a later file forward target top level",
      "\t- nested forward ref forward target nested",
      "- ref inside a property value",
      "  related:: ((66666666-6666-4666-8666-666666666603))",
      "",
    ].join("\n"),
  )
})
