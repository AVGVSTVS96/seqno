import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const open = async (page: import("@playwright/test").Page, name: string) => {
  await page.keyboard.press("Control+k")
  await page.getByRole("searchbox", { name: "Search" }).fill(name)
  await expect(page.getByRole("option").first()).toHaveText(name)
  await page.keyboard.press("Enter")

  return page.getByRole("article", { name, exact: true })
}

test.beforeEach(async ({ page, seqno }) => {
  await seedOpfs(page, fixtureGraph("graphs/org-and-front-matter"), ["graphs", "demo"])
  await seqno.openDemoGraph()
})

test("YAML front matter shows as the page's properties, and its alias and tags link", async ({
  page,
}) => {
  const notes = await open(page, "Field Notes")
  const properties = notes.getByRole("definition")
  await expect(notes.getByLabel("Page properties").getByRole("term")).toHaveText([
    "tags",
    "alias",
    "Author_Name",
    "rating",
    "draft",
  ])
  await expect(properties.nth(0).getByRole("link")).toHaveText(["botany", "Garden Plan"])
  await expect(notes.getByRole("treeitem").first()).toHaveText("Pressed three ferns by the creek")
  await properties.nth(1).getByRole("link", { name: "notes from the field" }).click()
  await expect(page.getByRole("article", { name: "Field Notes", exact: true })).toBeVisible()
})

test("an Org page reads Org's syntax: emphasis, links, tags, tasks and drawers", async ({
  page,
}) => {
  const list = await open(page, "Reading list")
  const blocks = list.getByRole("treeitem")
  await expect(blocks.nth(0)).toContainText("Finish Dune by Friday")
  await expect(blocks.nth(0).locator("em")).toHaveText("Dune")
  await expect(blocks.nth(0).locator("strong")).toHaveText("Friday")
  const notes = blocks.nth(1)
  await expect(notes.locator("code")).toHaveText(["verbatim", "code"])
  await expect(notes.locator("ins")).toHaveText("underline")
  await expect(notes.locator("del")).toHaveText("strike")
  await expect(notes.getByRole("link", { name: "a link" })).toHaveAttribute(
    "href",
    "https://example.com",
  )
  await expect(blocks.nth(2).getByRole("link", { name: "the garden plan" })).toBeVisible()
  await expect(blocks.nth(2).getByRole("link", { name: "#scifi" })).toBeVisible()
  await expect(blocks.nth(3)).toContainText("rating")
  await expect(blocks.nth(3)).not.toContainText(":PROPERTIES:")
  await expect(list.getByText("Neuromancer")).toHaveCount(0)
})

test("editing an Org block shows its drawer, and the edit survives a reload", async ({
  page,
  seqno,
}) => {
  const list = await open(page, "Reading list")
  await list.getByText("loved the ending").click()
  await expect(seqno.editor).toHaveText(
    "DONE Read [[Field Notes]]:PROPERTIES::rating: 5:END:loved the ending",
  )
  await page.keyboard.press("End")
  await page.keyboard.type(" twice")
  await page.keyboard.press("Escape")
  await seqno.saved()
  await page.reload()
  await expect(
    page.getByRole("article", { name: "Reading list", exact: true }).getByRole("treeitem").nth(3),
  ).toContainText("loved the ending twice")
})

test("an Org block's page link shows in that page's linked references", async ({ page }) => {
  const plan = await open(page, "Garden Plan")
  const references = page.getByRole("region", { name: /Linked references/u })
  await expect(references.getByText("see the garden plan and #scifi")).toBeVisible()
  await expect(plan.getByRole("treeitem").first()).toContainText("Read Field Notes")
})
