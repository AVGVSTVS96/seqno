import { readFile } from "node:fs/promises"
import type { Download, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const openGardenPlan = async (page: Page) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await openDemo(page, "/page/garden%20plan")
}

const exportDialog = (page: Page) => page.getByRole("dialog", { name: "Export" })

const openPageExport = async (page: Page) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Export page" }).click()
}

const saved = async (download: Download) => readFile((await download.path()) ?? "")

test("Export page writes text, OPML and HTML with Logseq's options", async ({ page }) => {
  await openGardenPlan(page)
  await openPageExport(page)
  const dialog = exportDialog(page)
  const text = dialog.getByRole("textbox", { name: "Exported text" })
  await expect(text).toHaveValue(
    [
      "alias:: Allotment",
      "plot:: 14B",
      "",
      "- Beds run north to south so neither row shades the other.",
      "- Winter",
      "\t- Garlic along the fence, planted before the first frost",
      "\t- Broad beans under fleece",
      "- Summer",
      "\t- Tomatoes and peppers move into [[projects/Greenhouse]]",
      "\t- Squash gets the compost corner",
      "- Seed orders go on the [[Seed Inventory]] page.",
      "",
    ].join("\n"),
  )
  await dialog.getByRole("combobox", { name: "Indentation style:" }).selectOption("no-indent")
  await dialog.getByRole("checkbox", { name: "[[text]] -> text" }).check()
  await dialog.getByRole("combobox", { name: "level <=" }).selectOption("1")
  await expect(text).toHaveValue(
    [
      "alias:: Allotment",
      "plot:: 14B",
      "",
      "Beds run north to south so neither row shades the other.",
      "Winter",
      "Summer",
      "Seed orders go on the Seed Inventory page.",
      "",
    ].join("\n"),
  )
  await dialog.getByRole("button", { name: "OPML" }).click()
  await expect(dialog.getByRole("combobox", { name: "Indentation style:" })).toHaveCount(0)
  await expect(text).toHaveValue(/<title>Garden Plan<\/title>/)
  await expect(text).toHaveValue(/<outline text="Seed orders go on the Seed Inventory page\."\/>/)
  await dialog.getByRole("combobox", { name: "level <=" }).selectOption("all")
  await dialog.getByRole("checkbox", { name: "[[text]] -> text" }).uncheck()
  await dialog.getByRole("button", { name: "HTML" }).click()
  await expect(text).toHaveValue(/^<ul>\n {2}<li>Beds run north/)
  await expect(text).toHaveValue(
    /<li>Tomatoes and peppers move into <a>\[\[projects\/Greenhouse\]\]<\/a><\/li>/,
  )
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Save to file" }).click()
  expect((await download).suggestedFilename()).toBe("seqno_Garden Plan.html")
  await page.keyboard.press("Escape")
  await openPageExport(page)
  await expect(dialog.getByRole("button", { name: "HTML" })).toHaveAttribute("aria-pressed", "true")
  await dialog.getByRole("button", { name: "Text" }).click()
  await expect(dialog.getByRole("combobox", { name: "Indentation style:" })).toHaveValue(
    "no-indent",
  )
  await dialog.getByRole("combobox", { name: "Indentation style:" }).selectOption("dashes")
})

test("Export page as PNG saves a picture of the rendered blocks", async ({ page }) => {
  await openGardenPlan(page)
  await openPageExport(page)
  const dialog = exportDialog(page)
  await dialog.getByRole("button", { name: "PNG" }).click()
  const picture = dialog.getByRole("img", { name: "Exported picture" })
  await expect(
    picture.getByText("Garlic along the fence, planted before the first frost"),
  ).toBeVisible()
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Save to file" }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("seqno_Garden Plan.png")
  const png = await saved(file)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(png.readUInt32BE(16)).toBeGreaterThan(300)
})

test("Copy / Export as exports the chosen block with its children", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await openGardenPlan(page)
  const winter = page
    .getByRole("main")
    .getByRole("treeitem")
    .filter({ hasText: /^Winter/ })
    .first()
  await winter.getByRole("button", { name: "Zoom into block" }).first().click({ button: "right" })
  await page
    .getByRole("menu", { name: "Block actions" })
    .getByRole("menuitem", { name: "Copy / Export as.." })
    .click()
  const dialog = exportDialog(page)
  await dialog.getByRole("button", { name: "Text" }).click()
  const text = dialog.getByRole("textbox", { name: "Exported text" })
  await expect(text).toHaveValue(
    "- Winter\n\t- Garlic along the fence, planted before the first frost\n\t- Broad beans under fleece\n",
  )
  await dialog.getByRole("button", { name: "Copy to clipboard" }).click()
  await expect(dialog.getByRole("button", { name: "Copied to clipboard!" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "- Winter\n\t- Garlic along the fence, planted before the first frost\n\t- Broad beans under fleece\n",
  )
})

test("Export graph downloads EDN, JSON and a markdown zip", async ({ page }) => {
  await openGardenPlan(page)
  const choose = async (label: string) => {
    await page.getByRole("button", { name: "More" }).click()
    await page.getByRole("menuitem", { name: "Export graph" }).click()
    const download = page.waitForEvent("download")
    await page
      .getByRole("dialog", { name: "Export graph" })
      .getByRole("button", { name: label })
      .click()
    return download
  }
  const edn = await choose("Export as EDN")
  expect(edn.suggestedFilename()).toMatch(/^demo_\d+\.edn$/)
  const ednText = (await saved(edn)).toString()
  expect(ednText.startsWith("{:version 1,\n :blocks\n [{:block/id #uuid ")).toBe(true)
  expect(ednText).toContain(':block/page-name "Garden Plan",')
  expect(ednText).toContain(':block/content "Broad beans under fleece",')
  await page.keyboard.press("Escape")
  const json = await choose("Export as JSON")
  expect(json.suggestedFilename()).toMatch(/^demo_\d+\.json$/)
  const parsed: unknown = JSON.parse((await saved(json)).toString())
  expect(parsed).toMatchObject({ version: 1 })
  await page.keyboard.press("Escape")
  const zip = await choose("Export as standard Markdown (no block properties)")
  expect(zip.suggestedFilename()).toMatch(/^demo_markdown_\d+\.zip$/)
  const bytes = await saved(zip)
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  expect(bytes.toString("latin1")).toContain("pages/Garden Plan.md")
})
