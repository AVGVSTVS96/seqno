import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { seedOpfs } from "../src/opfs.ts"
import { openPlugins, serveMarketplace } from "../src/plugins.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const install = async (page: Page, name: string) => {
  const dialog = await openPlugins(page)
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")
}

const openPage = async (page: Page, folder: string, lines: readonly string[]) => {
  await mkdir(join(folder, "pages"), { recursive: true })
  await writeFile(join(folder, "pages", "Calculus.md"), lines.join("\n"))
  await seedOpfs(page, folder, ["graphs", "demo"])
  await openDemo(page, "/page/calculus")
}

test("Logseq Display Math adds its KaTeX macros and draws inline math in display style, on math already on the page and after a reload", async ({
  page,
}, testInfo) => {
  await openPage(page, testInfo.outputPath("graph"), [
    "- The slope is $\\differentialD y$ over $\\differentialD x$",
    "- $$\\differentialD t$$",
  ])
  const main = page.getByRole("main")
  const inline = main.locator(".latex-inline").first()
  await expect(inline.locator(".katex-html")).toContainText("\\differentialD")

  await install(page, "Logseq Display Math")
  await expect(inline.locator(".katex annotation")).toHaveText("\\displaystyle \\differentialD y")
  await expect(inline.locator(".katex-html .mathrm")).toHaveText("d")
  const display = main.locator("div.latex")
  await expect(display.locator(".katex annotation")).toHaveText("\\differentialD t")
  await expect(display.locator(".katex-html")).not.toContainText("\\differentialD")

  await page.reload()
  await expect(main.locator(".latex-inline").first().locator(".katex annotation")).toHaveText(
    "\\displaystyle \\differentialD y",
  )
  await expect(main.locator(".latex-inline .katex-html").first()).not.toContainText(
    "\\differentialD",
  )
})

test("Extensions plus loads KaTeX physics through its enhancer, so \\dv and \\abs draw", async ({
  page,
}, testInfo) => {
  await openPage(page, testInfo.outputPath("graph"), [
    "- Velocity is $\\dv{x}{t}$ and speed is $\\abs{v}$",
  ])
  const main = page.getByRole("main")
  const first = main.locator(".latex-inline").first()
  await expect(first.locator(".katex-html")).toContainText("\\dv")

  await install(page, "Extensions plus")
  await expect(page.locator('script[data-ref="logseq-extensions-plus"]')).toHaveAttribute(
    "src",
    /\/lsp\/xyhp915\/logseq-extensions-plus\/0\.0\.5\/vendors\/katex\.physics\.js$/,
  )
  await expect(first.locator(".katex-html .mfrac")).toBeAttached()
  await expect(first.locator(".katex-html")).not.toContainText("\\dv")
  await expect(main.locator(".latex-inline").nth(1).locator(".katex-html")).not.toContainText(
    "\\abs",
  )

  await page.reload()
  await expect(main.locator(".latex-inline").first().locator(".katex-html .mfrac")).toBeAttached()
})
