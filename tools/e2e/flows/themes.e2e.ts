import { readFileSync } from "node:fs"
import type { Page } from "@playwright/test"
import { gaps, logseqAttributes, logseqClasses, logseqIds, selectorNames } from "@seqno/dom"
import { appAvailable } from "../src/env.ts"
import { openPlugins, serveMarketplace, useTheme } from "../src/plugins.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

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

const themeFiles = [
  "catppuccin/logseq/v0.6.4/ctp-latte.css",
  "catppuccin/logseq/v0.6.4/ctp-mocha.css",
  "pengx17/logseq-dev-theme/v1.26.17/custom.css",
  "pengx17/logseq-laurel-theme/v1.8.8/custom.css",
  "sethfair/logseq-atlas-theme/v0.3.5/custom.css",
  "stdword/logseq-bujo-theme/1.4.6/src/base.css",
  "stdword/logseq-bujo-theme/1.4.6/src/light-white.css",
  "stdword/logseq-bujo-theme/1.4.6/src/dark-black.css",
]

const themesSelect = () => {
  const selected = themeFiles.map((file) =>
    selectorNames(
      readFileSync(
        new URL(`../../../fixtures/logseq-plugins/files/${file}`, import.meta.url),
        "utf8",
      ),
    ),
  )
  return new Set([
    ...selected
      .flatMap((names) => names.classes.filter((name) => logseqClasses.has(name)))
      .map((name) => `.${name}`),
    ...selected
      .flatMap((names) => names.ids.filter((name) => logseqIds.has(name)))
      .map((name) => `#${name}`),
    ...selected
      .flatMap((names) => names.attributes.filter((name) => logseqAttributes.has(name)))
      .map((name) => `[${name}]`),
  ])
}

const renderedNames = (page: Page) =>
  page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll("*")].flatMap((element) => [
      ...[...element.classList].map((name) => `.${name}`),
      ...(element.id === "" ? [] : [`#${element.id}`]),
      ...[...element.attributes].map((attribute) => `[${attribute.name}]`),
    ]),
  )

test("seqno renders every Logseq name the fixture themes select, except the gaps it lists", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const rendered = new Set<string>()
  const collect = async () => {
    for (const name of await renderedNames(page)) rendered.add(name)
  }
  const editAtEnd = async () => {
    await page.getByRole("main").locator(".seqno-content").first().click()
    await page.keyboard.press("End")
  }
  await page.setViewportSize({ width: 1440, height: 4000 })
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await page.evaluate(() => localStorage.setItem("seqno.leftSidebar", "true"))
  await openDemo(page, "/page/showcase")
  await expect(page.locator(".seqno-query").first()).toBeVisible()
  await collect()
  await page.getByRole("main").getByRole("link", { name: "Reading List" }).first().hover()
  await expect(page.getByRole("dialog", { name: "Preview" })).toBeVisible({ timeout: 3000 })
  await collect()
  await page.mouse.move(0, 400)
  await openPlugins(page)
  await collect()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Toggle right sidebar" }).click()
  await expect(page.getByRole("complementary", { name: "Right sidebar" })).toBeVisible()
  await collect()
  await page.getByRole("main").locator(".seqno-bullet").first().click({ button: "right" })
  await expect(page.getByRole("menu")).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Search", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search" }).fill("greenhouse")
  await expect(
    page.getByRole("listbox", { name: "Nodes" }).getByRole("option").first(),
  ).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.getByRole("main").locator(".seqno-codeblock").first().click()
  await expect(page.getByRole("main").locator(".seqno-codeblock .cm-editor")).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await editAtEnd()
  await page.keyboard.type(" [[Gar")
  await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await editAtEnd()
  await page.keyboard.type(" /")
  await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await editAtEnd()
  await page.keyboard.press("Enter")
  await page.keyboard.insertText("{{embed [[Reading List]]}}")
  await page.keyboard.press("Escape")
  await expect(page.locator(".seqno-embed-title").first()).toBeVisible()
  await collect()
  await page.goto("/page/projects%2Fgreenhouse")
  await expect(page.locator(".seqno-references").first()).toBeVisible()
  await collect()
  await page.goto("/")
  await expect(page.locator(".seqno-journal").first()).toBeVisible()
  await collect()
  await page.evaluate(() => localStorage.setItem("seqno.theme", JSON.stringify("dark")))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await collect()
  const platforms = new Set([".is-mac", ".is-win32", ".is-linux"])
  expect([...platforms].filter((name) => rendered.has(name))).toHaveLength(1)
  const missing = [...themesSelect()]
    .filter((name) => !rendered.has(name) && !platforms.has(name))
    .toSorted()
  expect(missing).toEqual(Object.keys(gaps))
})
