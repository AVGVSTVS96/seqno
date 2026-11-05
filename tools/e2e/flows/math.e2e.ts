import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const reference = "6553c0ac-5b8e-4b37-9d43-d3e3e4b7a6f1"

const openMathPage = async (page: Page, folder: string) => {
  await mkdir(join(folder, "pages"), { recursive: true })
  await writeFile(
    join(folder, "pages", "Physics.md"),
    [
      "- Energy is $E = mc^2$ and momentum is \\(p = mv\\)",
      "- $$",
      "  \\int_0^1 x^2 \\, dx = \\frac{1}{3}",
      "  $$",
      "- \\begin{align}",
      "  a &= b + c \\\\",
      "  d &= e",
      "  \\end{align}",
      "- Water is $\\ce{H2O}$ and this is broken: $\\frac{1}{2$",
      "- Prices stay text: \\$5 and $ 10, and `$code$` too",
      "- Euler's identity $e^{i\\pi} + 1 = 0$",
      `  id:: ${reference}`,
    ].join("\n"),
  )
  await writeFile(
    join(folder, "pages", "Notes.md"),
    [`- As in ((${reference}))`, "- {{embed [[Physics]]}}", "- See [[Physics]] for $F = ma$"].join(
      "\n",
    ),
  )
  await seedOpfs(page, folder, ["graphs", "demo"])
  await openDemo(page, "/page/physics")
}

test("inline and display math render with KaTeX in Logseq's elements, and bad LaTeX shows KaTeX's red error", async ({
  page,
}, testInfo) => {
  await openMathPage(page, testInfo.outputPath("graph"))
  const main = page.getByRole("main").locator(".page-blocks-inner").first()
  const inline = main.locator(".latex-inline.initial")
  await expect(inline.first().locator(".katex annotation")).toHaveText("E = mc^2")
  await expect(inline.nth(1).locator(".katex annotation")).toHaveText("p = mv")
  await expect(inline.first().locator(".katex-display")).toHaveCount(0)

  const display = main.locator("div.latex.initial")
  await expect(display).toHaveCount(2)
  await expect(display.first().locator(".katex-display .katex annotation")).toHaveText(
    "\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n",
  )
  await expect(display.nth(1).locator(".katex-display .eqn-num")).toHaveCount(2)

  const water = inline.nth(2)
  await expect(water.locator(".katex annotation")).toHaveText("\\ce{H2O}")
  await expect(water.locator(".katex-html .msupsub")).toHaveText("2")
  await expect(water.locator(".katex-html")).not.toContainText("\\ce")
  const error = main.locator(".latex-inline .katex-error")
  await expect(error).toHaveText("\\frac{1}{2")
  await expect(error).toHaveAttribute("title", /^ParseError: KaTeX parse error/u)
  await expect(error).toHaveCSS("color", "rgb(204, 0, 0)")

  const prices = main.getByRole("treeitem").filter({ hasText: "Prices stay text" })
  await expect(prices).toContainText("Prices stay text: $5 and $ 10, and $code$ too")
  await expect(prices.locator(".katex")).toHaveCount(0)
})

test("clicking math edits its source, and leaving the block draws it again", async ({
  page,
}, testInfo) => {
  await openMathPage(page, testInfo.outputPath("graph"))
  const main = page.getByRole("main").locator(".page-blocks-inner").first()
  await main.locator("div.latex .katex-display").first().click()
  const editor = page.getByRole("treeitem").getByRole("textbox")
  await expect(editor).toHaveText("$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$")
  await page.keyboard.press("Control+End")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("End")
  await page.keyboard.insertText(" + C")
  await page.keyboard.press("Escape")
  await expect(editor).toHaveCount(0)
  await expect(main.locator("div.latex .katex annotation").first()).toHaveText(
    "\n\\int_0^1 x^2 \\, dx = \\frac{1}{3} + C\n",
  )

  const euler = main.getByRole("treeitem").filter({ hasText: "Euler's identity" })
  await euler.locator(".latex-inline .katex").click()
  await expect(editor).toContainText("Euler's identity $e^{i\\pi} + 1 = 0$")
  await page.keyboard.press("End")
  await page.keyboard.insertText(" and $\\sqrt{2}$")
  await page.keyboard.press("Escape")
  await expect(euler.locator(".latex-inline .katex annotation")).toHaveText([
    "e^{i\\pi} + 1 = 0",
    "\\sqrt{2}",
  ])
})

test("math renders in a block ref, an embed and linked references", async ({ page }, testInfo) => {
  await openMathPage(page, testInfo.outputPath("graph"))
  await page.goto("/page/notes")
  const main = page.getByRole("main")
  const ref = main.getByRole("treeitem").filter({ hasText: "As in" }).first()
  await expect(ref.locator(".latex-inline .katex annotation")).toHaveText("e^{i\\pi} + 1 = 0")
  const embed = main.locator(".embed-page")
  await expect(embed.locator("div.latex .katex-display")).toHaveCount(2)
  await expect(embed.locator(".latex-inline .katex annotation").first()).toHaveText("E = mc^2")

  await page.goto("/page/physics")

  const see = page
    .getByRole("main")
    .locator(".references.page-linked")
    .getByRole("treeitem")
    .filter({ hasText: "See" })

  await expect(see.locator(".latex-inline .katex annotation")).toHaveText("F = ma")
})
