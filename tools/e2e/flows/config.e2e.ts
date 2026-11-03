import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { appAvailable } from "../src/env.ts"
import { seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test("a property config.edn separates by commas shows each value as a link, and each value's page lists the block", async ({
  page,
}, testInfo) => {
  const folder = testInfo.outputPath("graph")
  await mkdir(join(folder, "pages"), { recursive: true })
  await mkdir(join(folder, "logseq"), { recursive: true })
  await writeFile(
    join(folder, "logseq", "config.edn"),
    "{:meta/version 1\n :property/separated-by-commas #{:genre}}\n",
  )
  await writeFile(
    join(folder, "pages", "books.md"),
    "- Dune\n  genre:: fiction, sci-fi\n  other:: a, b",
  )
  await seedOpfs(page, folder, ["graphs", "demo"])
  await openDemo(page, "/page/books")
  const dune = page.getByRole("article", { name: "books", exact: true }).getByRole("treeitem")
  await expect(dune.getByRole("link", { name: "fiction", exact: true })).toBeVisible()
  await expect(dune.getByRole("link", { name: "sci-fi", exact: true })).toBeVisible()
  await expect(dune.getByRole("link", { name: "a, b" })).toHaveCount(0)
  await expect(dune).toContainText("a, b")
  await dune.getByRole("link", { name: "sci-fi", exact: true }).click()
  await expect(page).toHaveURL(/\/page\/sci-fi$/)
  const linked = page.getByRole("region", { name: /^Linked references/ })
  await expect(linked.getByRole("region")).toHaveCount(1)
  await expect(linked.getByRole("region").first()).toHaveAccessibleName("books")
  await expect(linked).toContainText("Dune")
})
