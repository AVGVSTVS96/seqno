import type { Locator, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, opfsFiles, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const key = "Paper_1700000000000_0"
const green = "6ae9edd1-3d4a-41b9-b238-ec88d1525352"
const purple = "6ae9edd5-8708-4843-820f-da66eb9673cd"
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}"

const open = async (page: Page, name: string) => {
  await page.keyboard.press("Control+k")
  await page.getByRole("searchbox", { name: "Search" }).fill(name)
  await page.getByRole("option").first().click()
}

const viewer = (page: Page) => page.locator(".seqno-pdf")
const menu = (page: Page) => viewer(page).locator(".seqno-pdf-menu")
const pdfPage = (page: Page, n: number) => viewer(page).locator(`.page[data-page-number="${n}"]`)
const hlsPage = (page: Page) => page.getByRole("article", { name: "Paper" })

const openPaper = async (page: Page) => {
  await open(page, "Reading")
  await page.getByRole("main").getByText("Paper.pdf", { exact: true }).click()
  await expect(viewer(page).locator(".textLayer span").first()).toBeVisible()
}

const assets = async (page: Page): ReturnType<typeof opfsFiles> =>
  await opfsFiles(page, ["graphs", "demo", "assets"]).catch(async (error: unknown) =>
    String(error).includes("NotFoundError") ? await assets(page) : await Promise.reject(error),
  )

const highlightsFile = async (page: Page) =>
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory()
    const graph = await (await root.getDirectoryHandle("graphs")).getDirectoryHandle("demo")
    const file = await (await graph.getDirectoryHandle("assets")).getFileHandle(name)

    const read = async (): Promise<string> =>
      await (
        await file.getFile()
      )
        .text()
        .catch(async (error: unknown) =>
          error instanceof DOMException && error.name === "NotReadableError"
            ? await read()
            : await Promise.reject(error),
        )

    return await read()
  }, `${key}.edn`)

const exported = async (page: Page) => {
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Export page" }).click()
  const dialog = page.getByRole("dialog", { name: "Export" })
  const text = await dialog.getByRole("textbox", { name: "Exported text" }).inputValue()
  await page.keyboard.press("Escape")

  return text
}

const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

const selectLine = async (page: Page, line: Locator) => {
  await line.scrollIntoViewIfNeeded()
  const box = await line.boundingBox()

  if (box === null) {
    throw new Error("the line has no box")
  }

  await drag(
    page,
    { x: box.x + 1, y: box.y + box.height / 2 },
    { x: box.x + box.width - 1, y: box.y + box.height / 2 },
  )
}

const clipboard = async (page: Page) =>
  await page.evaluate(async () => await navigator.clipboard.readText())

test.beforeEach(async ({ page, seqno }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await seedOpfs(page, fixtureGraph("graphs/pdf-highlights"), ["graphs", "demo"])
  await seqno.openDemoGraph()
})

test("a PDF link opens Logseq's viewer on the left, at the page and with the highlights Logseq saved", async ({
  page,
}) => {
  await openPaper(page)
  await expect(viewer(page)).toHaveAttribute("id", "pdf-layout-container_1700000000000_0")
  await expect(page.locator("body")).toHaveClass(/seqno-pdf-open/u)
  await expect(page.locator("body")).toHaveClass(/is-pdf-active/u)
  await expect(
    page.locator(".extensions__pdf-container .extensions__pdf-viewer-cnt .extensions__pdf-viewer"),
  ).toHaveCount(1)
  await expect(page.locator(".extensions__pdf-toolbar .buttons")).toHaveCount(1)
  expect(
    await page.evaluate(() => {
      const active: unknown = Reflect.get(window, "lsActivePdfViewer")
      const element: unknown = Reflect.get(Object(active), "viewer")

      return element instanceof HTMLElement && element.ownerDocument === document
    }),
  ).toBe(true)
  await expect(viewer(page).getByRole("spinbutton", { name: "Page number" })).toHaveValue("2")
  await expect(viewer(page).locator(".seqno-pdf-pager small")).toHaveText("/ 2")
  await expect(pdfPage(page, 2).locator(`[data-highlight-id="${purple}"]`)).toHaveAttribute(
    "data-color",
    "purple",
  )
  await pdfPage(page, 1).scrollIntoViewIfNeeded()
  await expect(
    pdfPage(page, 1).locator(`[data-highlight-id="${green}"] .seqno-pdf-text-region-item`),
  ).toHaveAttribute("data-color", "green")
  const pane = await viewer(page).boundingBox()
  const main = await page.getByRole("main").boundingBox()
  expect(pane?.x).toBe(0)
  expect(main?.x ?? 0).toBeGreaterThanOrEqual((pane?.width ?? 0) + 15)
  await viewer(page).getByRole("button", { name: "Close" }).click()
  await expect(viewer(page)).toHaveCount(0)
  await expect(page.locator("body")).not.toHaveClass(/seqno-pdf-open/u)
  expect(await page.evaluate(() => Reflect.has(window, "lsActivePdfViewer"))).toBe(false)
})

test("picking a color for selected text makes a highlight, its annotation block and the .edn, and copies its ref", async ({
  page,
}) => {
  await openPaper(page)
  await selectLine(page, pdfPage(page, 1).locator(".textLayer span", { hasText: "second line" }))
  await expect(menu(page).locator("a[data-color]")).toHaveText([
    "yellow",
    "red",
    "green",
    "blue",
    "purple",
  ])
  await expect(menu(page).locator("li.seqno-pdf-item")).toHaveText(["Copy text"])
  await menu(page).locator("a[data-color=yellow]").click()
  await expect(menu(page)).toHaveCount(0)
  const made = pdfPage(page, 1).locator(".seqno-pdf-text-region-item[data-color=yellow]")
  await expect(made).toHaveCount(1)
  await expect.poll(async () => await clipboard(page)).toMatch(new RegExp(`^\\(\\(${uuid}\\)\\)$`))
  const id = (await clipboard(page)).slice(2, -2)
  await viewer(page).getByTitle("Annotations page").click()
  await expect(page).toHaveTitle("Paper")
  const blocks = hlsPage(page).getByRole("treeitem")
  await expect(blocks).toHaveText([
    "P1 The quick brown fox jumps",
    "P2",
    "P1 A second line of plain text",
  ])
  await expect(blocks.nth(2).locator("[data-type=annotation]")).toHaveAttribute(
    "data-hl-color",
    "yellow",
  )
  expect(await exported(page)).toBe(
    [
      `  file:: [${key}.pdf](../assets/${key}.pdf)`,
      `  file-path:: ../assets/${key}.pdf`,
      "  ",
      "- The quick brown fox jumps",
      "  ls-type:: annotation",
      "  hl-page:: 1",
      "  hl-color:: green",
      `  id:: ${green}`,
      "- [:span]",
      "  ls-type:: annotation",
      "  hl-page:: 2",
      "  hl-color:: purple",
      `  id:: ${purple}`,
      "  hl-type:: area",
      "  hl-stamp:: 1793715669070",
      "- A second line of plain text",
      "  ls-type:: annotation",
      "  hl-page:: 1",
      "  hl-color:: yellow",
      `  id:: ${id}`,
      "",
    ].join("\n"),
  )
  await viewer(page).getByRole("button", { name: "Close" }).click()
  await expect.poll(async () => await highlightsFile(page)).toContain(id)
  const file = await highlightsFile(page)
  expect(file).toContain(
    `              {:id #uuid "${id}",\n               :page 1,\n               :position {:bounding {:x1 `,
  )
  expect(file).toContain(
    `               :content {:text "A second line of plain text"},\n               :properties {:color "yellow"}}],\n :extra {:page 1}}\n`,
  )
})

test("a saved highlight's menu copies its ref and text, recolors it, links to its block and deletes it", async ({
  page,
}) => {
  await openPaper(page)
  await pdfPage(page, 1).scrollIntoViewIfNeeded()

  const region = pdfPage(page, 1).locator(
    `[data-highlight-id="${green}"] .seqno-pdf-text-region-item`,
  )

  await region.click()
  await expect(menu(page).locator("li.seqno-pdf-item")).toHaveText([
    "Copy ref",
    "Copy text",
    "Linked references",
    "Delete",
  ])
  await menu(page).getByText("Copy text").click()
  await expect.poll(async () => await clipboard(page)).toBe("The quick brown fox jumps")
  await region.click()
  await menu(page).getByText("Copy ref").click()
  await expect.poll(async () => await clipboard(page)).toBe(`((${green}))`)
  await region.click()
  await menu(page).locator("a[data-color=red]").click()
  await expect(region).toHaveAttribute("data-color", "red")
  await region.click()
  await menu(page).getByText("Linked references").click()
  await expect(page.getByRole("main").getByRole("treeitem").first()).toHaveText(
    "P1 The quick brown fox jumps",
  )
  await expect(page.getByRole("main").locator("[data-type=annotation]").first()).toHaveAttribute(
    "data-hl-color",
    "red",
  )
  await viewer(page).getByTitle("Annotations page").click()
  expect(await exported(page)).toMatch(
    new RegExp(
      `- The quick brown fox jumps\\n  ls-type:: annotation\\n  hl-page:: 1\\n  hl-color:: red\\n  id:: ${green}\\n  hl-stamp:: \\d{13}\\n`,
    ),
  )
  await region.click()
  await menu(page).getByText("Delete").click()
  await expect(region).toHaveCount(0)
  await expect(hlsPage(page).getByRole("treeitem")).toHaveText(["P2"])
  await viewer(page).getByRole("button", { name: "Close" }).click()
  await expect.poll(async () => await highlightsFile(page)).not.toContain(green)
})

test("dragging out an area makes an area highlight with its picture, shown in its block", async ({
  page,
}) => {
  await openPaper(page)
  const box = await pdfPage(page, 2).boundingBox()

  if (box === null) {
    throw new Error("page 2 has no box")
  }

  await page.keyboard.down("Shift")
  await drag(page, { x: box.x + 40, y: box.y + 30 }, { x: box.x + 260, y: box.y + 110 })
  await page.keyboard.up("Shift")
  await expect(menu(page).locator("li.seqno-pdf-item")).toHaveCount(0)
  await menu(page).locator("a[data-color=blue]").click()
  const area = pdfPage(page, 2).locator(".seqno-pdf-area-region[data-color=blue]")
  await expect(area).toHaveCount(1)
  await expect.poll(async () => await clipboard(page)).toMatch(new RegExp(`^\\(\\(${uuid}\\)\\)$`))
  const id = (await clipboard(page)).slice(2, -2)
  const picture = new RegExp(`^${key}/2_${id}_(\\d{13})\\.png$`)
  await expect
    .poll(async () => Object.keys(await assets(page)).filter((path) => picture.test(path)))
    .toHaveLength(1)
  const files = await assets(page)
  const png = Object.entries(files).find(([path]) => picture.test(path))
  expect([...(png?.[1].slice(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47])
  const stamp = picture.exec(png?.[0] ?? "")?.[1]
  await viewer(page).getByTitle("Annotations page").click()
  const block = hlsPage(page).getByRole("treeitem").nth(2)
  await expect(block).toHaveText("P2")
  await expect(block.locator(".seqno-annotation-area img")).toHaveJSProperty("naturalWidth", 220)
  expect(await exported(page)).toContain(
    `- [:span]\n  ls-type:: annotation\n  hl-page:: 2\n  hl-color:: blue\n  id:: ${id}\n  hl-type:: area\n  hl-stamp:: ${stamp}\n`,
  )
  await area.click()
  await expect(menu(page).locator("li.seqno-pdf-item")).toHaveText([
    "Copy ref",
    "Linked references",
    "Delete",
  ])
  await menu(page).getByText("Delete").click()
  await expect
    .poll(async () => Object.keys(await assets(page)).filter((path) => picture.test(path)))
    .toHaveLength(0)
})

test("the P<n> prefix and a ((ref)) to an annotation open the viewer at the highlight", async ({
  page,
}) => {
  await open(page, `hls__${key}`)
  const prefixes = hlsPage(page).locator(".seqno-annotation-prefix strong")
  await expect(prefixes).toHaveText(["P1", "P2"])
  await prefixes.first().dispatchEvent("mousedown", { button: 0 })
  await expect(pdfPage(page, 1).locator(`[data-highlight-id="${green}"]`)).toHaveClass(
    /seqno-pdf-flash/u,
  )
  await expect(viewer(page).getByRole("spinbutton", { name: "Page number" })).toHaveValue("1")
  await viewer(page).getByRole("button", { name: "Close" }).click()
  await open(page, "Reading")
  const reading = page.getByRole("main").getByRole("treeitem").first()
  await reading.click()
  await page.keyboard.press("End")
  await page.keyboard.type(` ((${purple}))`)
  await page.keyboard.press("Escape")
  const ref = reading.locator(".seqno-annotation-ref[data-type=annotation]")
  await expect(ref).toHaveAttribute("data-hl-type", "area")
  await expect(ref.locator(".seqno-annotation-prefix strong")).toHaveText("P2")
  await ref.locator(".seqno-annotation-prefix strong").dispatchEvent("mousedown", { button: 0 })
  await expect(pdfPage(page, 2).locator(`[data-highlight-id="${purple}"]`)).toHaveClass(
    /seqno-pdf-flash/u,
  )
})

test("the toolbar pages, zooms, searches, lists highlights, changes theme and closes with alt+x", async ({
  page,
}) => {
  await openPaper(page)
  const pager = viewer(page).getByRole("spinbutton", { name: "Page number" })
  await pager.fill("1")
  await pager.press("Enter")
  await expect(pager).toHaveValue("1")
  await viewer(page).getByTitle("Next page").click()
  await expect(pager).toHaveValue("2")
  const width = async () => (await pdfPage(page, 1).boundingBox())?.width ?? 0
  const before = await width()
  await viewer(page).getByTitle("Zoom in").click()
  await expect.poll(width).toBeGreaterThan(before)
  await viewer(page).getByTitle("Search").click()
  const search = viewer(page).getByPlaceholder("search")
  await search.fill("lazy dog")
  await search.press("Enter")
  await expect(viewer(page).locator(".seqno-pdf-finder .seqno-pdf-find-result")).toHaveText(
    '1 of 1 matches ("lazy dog")',
  )
  await search.press("Escape")
  await search.press("Escape")
  await expect(search).toHaveCount(0)
  await viewer(page).getByTitle("Outline").click()
  await viewer(page).getByRole("button", { name: "Highlights" }).click()
  await expect(viewer(page).locator(".seqno-pdf-highlights-item h6 strong")).toHaveText([
    "Page 1",
    "Page 2",
  ])
  await viewer(page).getByRole("button", { name: "Contents" }).click()
  await expect(viewer(page).getByText("No outlines")).toBeVisible()
  await viewer(page).getByTitle("More settings").click()
  await viewer(page).getByRole("button", { name: "dark" }).click()
  await expect(viewer(page)).toHaveAttribute("data-theme", "dark")
  await viewer(page).getByRole("switch", { name: "Dashed style for area highlight" }).click()
  await expect(viewer(page).locator(".seqno-pdf-viewer")).toHaveClass(/is-area-dashed/u)
  await page.locator("body").click({ position: { x: 900, y: 600 } })
  await page.keyboard.press("Alt+x")
  await expect(viewer(page)).toHaveCount(0)
  await page.reload()
  await openPaper(page)
  await expect(viewer(page)).toHaveAttribute("data-theme", "dark")
})
