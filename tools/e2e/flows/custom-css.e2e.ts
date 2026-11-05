import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const outline = (color: string) => `.ls-block { outline: 3px solid ${color} }`

const seedGraph = async (page: Page, folder: string) => {
  await mkdir(join(folder, "pages"), { recursive: true })
  await mkdir(join(folder, "logseq"), { recursive: true })
  await writeFile(join(folder, "pages", "garden.md"), "- Tomatoes go next to [[Basil]]\n")
  await writeFile(join(folder, "logseq", "config.edn"), "{:meta/version 1}\n")
  await writeFile(join(folder, "logseq", "custom.css"), `${outline("rgb(255, 0, 0)")}\n`)
  await seedOpfs(page, folder, ["graphs", "demo"])
}

const blockOutline = async (page: Page) =>
  await page
    .getByRole("main")
    .getByRole("treeitem")
    .first()
    .evaluate((row) => {
      const block = row.closest(".ls-block") ?? row.querySelector(".ls-block")

      return block === null ? "" : getComputedStyle(block).outlineColor
    })

const writeOpfs = async (page: Page, path: readonly string[], text: string) => {
  await page.evaluate(
    async ({ parts, body }) => {
      let dir = await navigator.storage.getDirectory()

      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part)
      }

      const file = await dir.getFileHandle(parts.at(-1) ?? "")
      const writable = await file.createWritable()
      await writable.write(body)
      await writable.close()
    },
    { parts: path, body: text },
  )
}

const openSettings = async (page: Page) => {
  await page.getByRole("banner").getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()

  return page.getByRole("dialog", { name: "Settings" })
}

const fileEditor = (page: Page) => page.getByRole("main").getByRole("textbox")

const replaceFile = async (page: Page, text: string) => {
  await fileEditor(page).click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText(text)
  await page.getByRole("main").getByRole("heading", { level: 1 }).click()
}

const readOpfs = async (page: Page, path: readonly string[]) =>
  await page.evaluate(async (parts) => {
    let dir = await navigator.storage.getDirectory()

    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part)
    }

    return await (await (await dir.getFileHandle(parts.at(-1) ?? "")).getFile()).text()
  }, path)

const appFile = (name: string) => ["graphs", "demo", "logseq", name]

test("the graph's custom.css restyles Logseq's classes, and follows edits on its file page and on disk without a reload", async ({
  page,
}, info) => {
  await seedGraph(page, info.outputPath("graph"))
  await openDemo(page, "/page/garden")
  await expect.poll(async () => await blockOutline(page)).toBe("rgb(255, 0, 0)")
  await page.evaluate(() => Object.assign(window, { e2eSameLoad: true }))

  const settings = await openSettings(page)
  await settings.getByRole("link", { name: "Edit custom.css" }).click()
  await expect(page).toHaveURL(/\/file\/logseq%2Fcustom\.css$/u)
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
    "logseq/custom.css",
  )
  await expect(fileEditor(page)).toHaveText(outline("rgb(255, 0, 0)"))
  await replaceFile(page, outline("rgb(0, 0, 255)"))
  await expect
    .poll(async () => await readOpfs(page, appFile("custom.css")))
    .toBe(`${outline("rgb(0, 0, 255)")}\n`)

  await page.goBack()
  await expect.poll(async () => await blockOutline(page)).toBe("rgb(0, 0, 255)")

  await writeOpfs(page, appFile("custom.css"), outline("rgb(0, 128, 0)"))
  await expect.poll(async () => await blockOutline(page)).toBe("rgb(0, 128, 0)")
  expect(await page.evaluate(() => "e2eSameLoad" in window)).toBe(true)
})

test("Edit config.edn opens Logseq's file page, and its edits apply live", async ({
  page,
}, info) => {
  await seedGraph(page, info.outputPath("graph"))
  await openDemo(page, "/page/garden")
  const ref = page.getByRole("main").locator(".seqno-pageref", { hasText: "Basil" }).first()
  const brackets = ref.locator(".seqno-bracket")
  await expect(brackets).toHaveCount(2)

  const settings = await openSettings(page)
  await expect(settings.getByRole("link", { name: /^Edit /u })).toHaveText([
    "Edit config.edn",
    "Edit custom.css",
    "Edit export.css",
  ])
  await settings.getByRole("link", { name: "Edit config.edn" }).click()
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
    "logseq/config.edn",
  )
  await expect(fileEditor(page)).toHaveText("{:meta/version 1}")

  await replaceFile(page, "{:meta/version 1")
  await expect(page.getByRole("status")).toContainText("Failed to read file logseq/config.edn")
  expect(await readOpfs(page, appFile("config.edn"))).toBe("{:meta/version 1}\n")
  await replaceFile(page, "{:meta/version 1\n :ui/show-brackets? false}")
  await expect
    .poll(async () => await readOpfs(page, appFile("config.edn")))
    .toBe("{:meta/version 1\n :ui/show-brackets? false}\n")
  await page.goBack()
  await expect(ref).toBeVisible()
  await expect(brackets).toHaveCount(0)
})

test("the Files filter lists logseq/ files and opens them on the file page", async ({
  page,
}, info) => {
  await seedGraph(page, info.outputPath("graph"))
  await openDemo(page, "/page/garden")
  await page.keyboard.press("ControlOrMeta+k")
  const palette = page.getByRole("dialog", { name: "Search" })
  await palette.getByRole("searchbox", { name: "Search" }).fill("/fil")
  await page.keyboard.press("Enter")
  await palette.getByRole("searchbox", { name: "Search" }).fill("logseq/")
  const files = palette.getByRole("listbox", { name: "Files" }).getByRole("option")
  await expect(files).toHaveText(["logseq/config.edn", "logseq/custom.css"])
  await files.nth(1).click()
  await expect(page).toHaveURL(/\/file\/logseq%2Fcustom\.css$/u)
  await expect(fileEditor(page)).toHaveText(outline("rgb(255, 0, 0)"))
})
