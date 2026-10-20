import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { seedOpfs } from "./opfs.ts"
import { expect, openDemo } from "./test.ts"

export const longOutline = (blocks: number, { pictures = true } = {}) =>
  Array.from({ length: blocks }, (_, n) => {
    const indent = n % 5 === 0 ? "" : "\t"
    const words = n % 9 === 0 ? 70 : n % 4
    const picture = pictures && n % 25 === 12 ? ` ![](https://pictures.seqno.test/${n}.svg)` : ""
    return `${indent}- row ${n + 1}${" and more".repeat(words)}${picture}`
  }).join("\n")

export const latePictures = (page: Page) =>
  page.route("https://pictures.seqno.test/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"/>',
    })
  })

export const openLongPage = async (page: Page, others: ReadonlyArray<string> = []) => {
  const folder = await mkdtemp(join(tmpdir(), "seqno-long-"))
  await mkdir(join(folder, "pages"))
  await writeFile(join(folder, "pages", "long.md"), longOutline(3000))
  await Promise.all(
    others.map((name) => writeFile(join(folder, "pages", `${name}.md`), `- ${name}\n`)),
  )
  await seedOpfs(page, folder, ["graphs", "demo"])
  await rm(folder, { recursive: true })
  await latePictures(page)
  await openDemo(page, "/page/long")
  await expect(page.getByRole("main").getByRole("treeitem").first()).toHaveText(/^row 1 /)
}
