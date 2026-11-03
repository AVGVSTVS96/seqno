import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { openPlugins, serveMarketplace, useTheme } from "../src/plugins.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const gettingStarted = async (page: Page) => {
  await page.goto("/page/getting%20started")
  const outline = page.getByRole("treeitem").filter({ hasText: /^Outline$/ })
  await outline.hover()
  await outline.getByRole("button", { name: "Collapse" }).click()
  await page.mouse.move(0, 400)
}

test("Atlas theme restyles seqno through Logseq's class names: dashed links, its dark sidebar, its tinted right sidebar", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await gettingStarted(page)
  await expect(page.locator("a.page-ref").first()).toHaveCSS("border-bottom-style", "none")
  await useTheme(page, "Atlas Theme", "Atlas Theme: Light")
  await expect(page.locator("a.page-ref").first()).toHaveCSS("border-bottom-style", "dashed")
  await expect(page.locator(".white-theme #left-sidebar > .left-sidebar-inner")).toHaveCSS(
    "background-color",
    "rgb(24, 32, 38)",
  )
  await expect(page.locator(".cp__right-sidebar")).toHaveCSS(
    "background-color",
    "rgb(245, 248, 250)",
  )
  await expect(page.locator(".ls-block .form-checkbox").first()).toHaveCSS("border-radius", "2px")
  await expect(page.locator("h1.page-title")).toHaveCSS("color", "rgb(24, 32, 38)")
})

test("Bullet Journal's White theme sets its headings, page title and sidebar on seqno's Logseq-named elements", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await useTheme(page, "Bullet Journal theme", "White")
  await page.goto("/page/queries")
  await expect(page.locator(".ls-block h2").first()).toHaveCSS("font-size", "25.6px")
  await expect(page.locator(".page-title-sizer-wrapper > .title")).toHaveCSS("font-weight", "700")
  await expect(page.locator("h1.page-title")).toHaveCSS("color", "rgb(28, 26, 23)")
  await expect(page.locator("#left-sidebar > .left-sidebar-inner")).toHaveCSS(
    "background-color",
    "rgb(252, 253, 253)",
  )
  await expect(page.locator(".page-ref").first()).toHaveCSS("color", "rgb(59, 135, 206)")
})

test("Laurel theme resizes the header, bullets and checkboxes, and the default theme puts seqno's back", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await gettingStarted(page)
  const folded = page.locator(".ls-block[data-collapsed] .bullet-container.bullet-closed")
  await expect(page.locator("#head.cp__header")).toHaveCSS("height", "48px")
  await useTheme(page, "Laurel theme", "Laurel theme")
  await expect(page.locator("#head.cp__header")).toHaveCSS("height", "50px")
  await expect(page.locator(".ls-block .bullet-container").first()).toHaveCSS("width", "14px")
  await expect(folded).toHaveCSS("background-color", "rgb(164, 164, 164)")
  await expect(page.locator(".ls-block .form-checkbox").first()).toHaveCSS(
    "border-top-width",
    "2px",
  )
  const dialog = await openPlugins(page)
  await dialog.getByRole("radio", { name: /^Themes/ }).click()
  await dialog.getByRole("radio", { name: "Logseq default theme" }).click()
  await page.keyboard.press("Escape")
  await expect(page.locator("#head.cp__header")).toHaveCSS("height", "48px")
  await expect(page.locator(".ls-block .bullet-container").first()).toHaveCSS("width", "16px")
})

test("Dev theme labels headings, shrinks bullets and lays out the left sidebar through Logseq's names", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await useTheme(page, "Dev theme", "Dev theme")
  await page.goto("/page/queries")
  const heading = page.locator(".ls-block h2").first()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element, "::after").content))
    .toBe('"h2"')
  await expect(page.locator(".ls-block .bullet-container").first()).toHaveCSS("height", "14px")
  await expect(page.locator(".left-sidebar-inner > .wrap")).toHaveCSS("padding-top", "12px")
  await expect(page.locator(".left-sidebar-inner > .wrap")).toHaveCSS("margin-top", "0px")
})

test("Catppuccin Mocha turns seqno dark and colors its sidebar, folded bullets and checkboxes through Logseq's names", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await gettingStarted(page)
  await useTheme(page, "Catppuccin", "Catppuccin Mocha")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.locator("html[data-color=logseq] #left-sidebar")).toHaveCSS(
    "background-color",
    "rgb(24, 24, 37)",
  )
  await expect(page.locator(".ls-block .bullet-container.bullet-closed")).toHaveCSS(
    "background-color",
    "rgba(137, 180, 250, 0.15)",
  )
  await expect(page.locator(".ls-block .form-checkbox").first()).toHaveCSS("border-radius", "4px")
  await expect(page.locator("h1.page-title")).toHaveCSS("color", "rgb(186, 194, 222)")
})

test("Catppuccin's accent setting, under its settings gear as in Logseq, recolors its links", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await useTheme(page, "Catppuccin", "Catppuccin Mocha")
  const link = seqno.today.locator("a.page-ref").first()
  await expect(link).toHaveCSS("color", "rgb(137, 180, 250)")
  const dialog = await openPlugins(page)
  await dialog.getByRole("radio", { name: /^Themes/ }).click()
  await dialog.getByRole("button", { name: "Catppuccin settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  await settings.getByRole("combobox").selectOption("Red")
  await expect(link).toHaveCSS("color", "rgb(243, 139, 168)")
  await page.reload()
  await expect(seqno.today.locator("a.page-ref").first()).toHaveCSS("color", "rgb(243, 139, 168)")
})
