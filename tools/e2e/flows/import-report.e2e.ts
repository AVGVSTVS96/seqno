import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test("the import lists the files it left out or changed until you close it", async ({
  page,
  seqno,
}) => {
  await seedOpfs(page, fixtureGraph("graphs/duplicated-block-ids"), ["graphs", "demo"])
  await seqno.openDemoGraph()
  const report = page.getByRole("alert").filter({ hasText: "The import left out or changed" })
  await expect(report).toContainText("The import left out or changed 2 files")
  await expect(report).toContainText("pages/duplicated-ids.md")
  await expect(report.getByRole("listitem").first()).toContainText("repeats the block id")
  await page.screenshot({ path: test.info().outputPath("import-report.png") })
  await report.getByRole("button", { name: "Close" }).click()
  await expect(report).toHaveCount(0)
})
