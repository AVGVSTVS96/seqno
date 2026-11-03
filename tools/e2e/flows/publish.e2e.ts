import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, opfsFiles, seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const markPublic = async (file: string) =>
  writeFile(file, `public:: true\n${await readFile(file, "utf8")}`)

test("Export public pages writes a site that opens from disk", async ({ page, browser }, info) => {
  const graph = info.outputPath("graph")
  await cp(fixtureGraph("graphs/showcase"), graph, { recursive: true })
  await markPublic(join(graph, "pages", "Garden Plan.md"))
  await markPublic(join(graph, "pages", "Seed Inventory.md"))
  await markPublic(join(graph, "pages", "Showcase.md"))
  await writeFile(join(graph, "logseq", "custom.css"), ".seqno-page-title { letter-spacing: 1px }")
  await seedOpfs(page, graph, ["graphs", "demo"])
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle("published", { create: true })
  })
  await openDemo(page, "/page/garden%20plan")

  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Export graph" }).click()
  await page
    .getByRole("dialog", { name: "Export graph" })
    .getByRole("button", { name: "Export public pages" })
    .click()
  await expect(
    page.getByText("Export public pages and publish assets to published successfully"),
  ).toBeVisible()

  const files = await opfsFiles(page, ["published"])
  expect(Object.keys(files).toSorted()).toEqual([
    "404.html",
    "assets/greenhouse-sketch.svg",
    "index.html",
    "static/css/custom.css",
    "static/css/export.css",
    "static/img/logo.svg",
    "static/js/custom.js",
    "static/js/seqno.js",
  ])
  const site = info.outputPath("site")
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(site, path)), { recursive: true })
    await writeFile(join(site, path), bytes)
  }
  const index = Buffer.from(files["index.html"] ?? new Uint8Array()).toString()
  expect(index).toContain("Broad beans under fleece")
  expect(index).not.toContain("San Marzano tomatoes. #greenhouse")
  expect(Buffer.from(files["static/css/custom.css"] ?? new Uint8Array()).toString()).toContain(
    "letter-spacing",
  )

  const viewer = await browser.newPage()
  const errors: Array<string> = []
  viewer.on("pageerror", (error) => errors.push(error.message))
  await viewer.goto(`${pathToFileURL(join(site, "index.html")).href}#/page/garden%20plan`)
  await expect(viewer).toHaveTitle("Garden Plan")
  const main = viewer.getByRole("main")
  await expect(main.getByText("Broad beans under fleece")).toBeVisible()
  await expect(main.getByRole("region", { name: "Linked references" })).toContainText(
    "Seed Inventory",
  )

  await main.getByText("Seed Inventory", { exact: true }).first().click()
  await expect(viewer).toHaveTitle("Seed Inventory")
  await expect(main.getByText("Tomato, San Marzano")).toBeVisible()

  await viewer.getByRole("link", { name: "Pages" }).click()
  const table = viewer.getByRole("table", { name: "All pages" })
  await expect(table.getByRole("link")).toHaveCount(3)
  expect((await table.getByRole("link").allInnerTexts()).toSorted()).toEqual([
    "Garden Plan",
    "Seed Inventory",
    "Showcase",
  ])
  await table.getByRole("link", { name: "Showcase" }).click()
  await expect(main.getByRole("img", { name: "Greenhouse sketch" })).toBeVisible()
  await expect
    .poll(() =>
      main
        .getByRole("img", { name: "Greenhouse sketch" })
        .evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
    )
    .toBe(true)

  await main.getByText("Reading List", { exact: true }).first().click()
  await expect(main.getByText("This page isn't published.")).toBeVisible()
  await expect(main.getByText("Started the")).toHaveCount(0)

  await viewer.goto(`${pathToFileURL(join(site, "index.html")).href}#/page/garden%20plan`)
  await main.getByText("Broad beans under fleece").click()
  await expect(main.getByRole("textbox")).toHaveCount(0)
  expect(errors).toEqual([])
})
