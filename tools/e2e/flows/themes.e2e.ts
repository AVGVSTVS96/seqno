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
  const outline = page.getByRole("treeitem").filter({ hasText: /^Outline$/u })
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
  await dialog.getByRole("radio", { name: /^Themes/u }).click()
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
    .poll(
      async () => await heading.evaluate((element) => getComputedStyle(element, "::after").content),
    )
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
  await dialog.getByRole("radio", { name: /^Themes/u }).click()
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
        "utf-8",
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

const renderedNames = async (page: Page) =>
  await page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll("*")].flatMap((element) => [
      ...[...element.classList].map((name) => `.${name}`),
      ...(element.id === "" ? [] : [`#${element.id}`]),
      ...[...element.attributes].map((attribute) => `[${attribute.name}]`),
    ]),
  )

type Collect = () => Promise<void>

const pluginScreens = async (page: Page, collect: Collect) => {
  const plugins = await openPlugins(page)
  await collect()
  await plugins.getByRole("tab", { name: "Marketplace" }).click()
  await plugins.getByRole("radio", { name: /^Themes/u }).click()
  const card = plugins.getByRole("listitem", { name: "Catppuccin" })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await collect()
  await plugins.getByRole("tab", { name: "Installed" }).click()
  await plugins.getByRole("radio", { name: /^Themes/u }).click()
  await expect(plugins.getByRole("radiogroup", { name: "Theme" })).toBeVisible()
  await collect()
  await plugins.getByRole("button", { name: "Catppuccin settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  await expect(settings.getByRole("combobox")).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await expect(settings).toBeHidden()
  await plugins.getByRole("tab", { name: "Marketplace" }).click()
  await plugins.getByRole("radio", { name: /^Plugins/u }).click()
  const randomNote = plugins.getByRole("listitem", { name: "Random Note" })
  await randomNote.getByRole("button", { name: "Install" }).click()
  await expect(randomNote.getByRole("button", { name: "Installed" })).toBeDisabled()
  await plugins.getByRole("tab", { name: "Installed" }).click()
  await plugins.getByRole("radio", { name: /^Plugins/u }).click()
  await plugins.getByRole("button", { name: "Random Note settings" }).click()
  await expect(settings.getByRole("radio").first()).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await expect(settings).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(plugins).toBeHidden()
  await page.getByRole("button", { name: "Plugin toolbar items" }).click()
  await expect(page.getByRole("menu", { name: "Plugin toolbar items" })).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
}

const listScreens = async (page: Page, collect: Collect) => {
  await page.goto("/all-pages")
  await page.getByRole("button", { name: "Search pages" }).click()
  await expect(page.getByRole("searchbox", { name: "Search pages" })).toBeVisible()
  await collect()
  await page.goto("/graph")
  await expect(page.getByRole("application", { name: "Graph canvas" })).toBeVisible()
  await collect()
}

const themeNamesScreens = async (page: Page, collect: Collect) => {
  const main = page.getByRole("main")
  await page.goto("/page/theme%20names")
  const code = main.locator(".seqno-codeblock")
  await expect(code).toHaveCount(5)
  await expect(main.locator(".seqno-admonition")).toHaveCount(6)
  const sidebar = page.getByRole("complementary", { name: "Left sidebar" })
  await sidebar.getByRole("link", { name: "Journals" }).click()
  await page.goBack()
  await expect(code).toHaveCount(5)
  await expect(sidebar.locator(".page-icon").first()).toBeVisible()
  await collect()
  await code.filter({ hasText: "defn water" }).click()
  await page.keyboard.press("End")
  await expect(page.locator(".CodeMirror-matchingbracket")).toHaveCount(2)
  await collect()
  await page.keyboard.press("Shift+Home")
  await expect(page.locator(".CodeMirror-selected").first()).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await main.locator(".seqno-page-title").click()
  await expect(page.getByRole("textbox", { name: "Page title" })).toBeFocused()
  await collect()
  await page.keyboard.press("Escape")

  for (const level of ["two", "three", "four", "five", "six"]) {
    await main.locator(".seqno-content", { hasText: `Heading ${level}` }).click()
    await expect(page.locator(".seqno-editor-content:focus")).toHaveText(
      new RegExp(`Heading ${level}`, "u"),
    )
    await collect()
    await page.keyboard.press("Escape")
  }

  const scheduled = main.locator(".seqno-row", { hasText: "A block to schedule" })
  await scheduled.locator(".seqno-content").click()
  await page.keyboard.press("End")
  await page.keyboard.type(" /Scheduled")
  await page.keyboard.press("Enter")
  const picker = page.getByRole("dialog", { name: "Scheduled date" })
  await expect(picker).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await expect(picker).toBeHidden()
  await page.keyboard.press("Escape")
  const bullet = await scheduled.locator(".seqno-bullet").boundingBox()

  if (bullet === null) {
    throw new Error("the bullet has no box")
  }

  const at = { x: bullet.x + bullet.width / 2, y: bullet.y + bullet.height / 2 }
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 12, at.y + 30, { steps: 6 })
  await expect(main.locator(".block-highlight")).toHaveCount(1)
  await collect()
  await page.mouse.move(at.x, at.y, { steps: 3 })
  await page.mouse.up()
  await page.getByRole("banner").getByRole("button", { name: "More" }).click()
  await page
    .getByRole("menu", { name: "More" })
    .getByRole("menuitem", { name: "View as slides" })
    .click()
  await expect(page.getByRole("complementary").locator(".seqno-slides-deck .hljs")).toHaveCount(5)
  await collect()
  await page.setViewportSize({ width: 1440, height: 300 })
  await page.locator(".nav-contents-container").evaluate((contents) => {
    contents.scrollTo(0, 60)
  })
  await expect(page.locator(".nav-contents-container.is-scrolled")).toHaveCount(1)
  await collect()
  await page.setViewportSize({ width: 1440, height: 4000 })
}

const pdfScreens = async (page: Page, collect: Collect) => {
  await page.goto("/page/reading")
  await page.getByRole("main").getByText("Paper.pdf", { exact: true }).click()
  const pdf = page.locator(".seqno-pdf")
  const text = pdf.locator(".textLayer span").first()
  await expect(text).toBeVisible()
  await collect()

  for (const title of ["More settings", "Search", "Outline"]) {
    await pdf.getByTitle(title, { exact: true }).click()

    if (title === "Search") {
      await pdf.getByPlaceholder("search").fill("fox")
      await expect(pdf.getByTitle("Enter to search")).toBeVisible()
    }

    await collect()
    await pdf.getByTitle(title, { exact: true }).click()
  }

  const line = await text.boundingBox()

  if (line === null) {
    throw new Error("the line has no box")
  }

  await page.mouse.move(line.x + 1, line.y + line.height / 2)
  await page.mouse.down()
  await page.mouse.move(line.x + line.width - 1, line.y + line.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(pdf.locator(".seqno-pdf-menu")).toBeVisible()
  await collect()
  await page.keyboard.press("Escape")
  await page.goto("/page/hls__paper_1700000000000_0")
  await expect(page.getByRole("main").getByText("The quick brown fox jumps")).toBeVisible()
  await collect()
}

test("seqno renders every Logseq name the fixture themes select, except the gaps it lists", async ({
  page,
}) => {
  test.setTimeout(240_000)
  const rendered = new Set<string>()

  const collect = async () => {
    for (const name of await renderedNames(page)) {
      rendered.add(name)
    }
  }

  const editAtEnd = async () => {
    await page.getByRole("main").locator(".seqno-content").first().click()
    await page.keyboard.press("End")
  }

  await page.setViewportSize({ width: 1440, height: 4000 })
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await seedOpfs(page, fixtureGraph("graphs/theme-names/pages"), ["graphs", "demo", "pages"])
  await seedOpfs(page, fixtureGraph("graphs/pdf-highlights/pages"), ["graphs", "demo", "pages"])
  await seedOpfs(page, fixtureGraph("graphs/pdf-highlights/assets"), ["graphs", "demo", "assets"])
  await page.evaluate(() => {
    localStorage.setItem("seqno.leftSidebar", "true")
  })
  await openDemo(page, "/page/showcase")
  await expect(page.locator(".seqno-query").first()).toBeVisible()
  await collect()
  await page.getByRole("main").getByRole("link", { name: "Reading List" }).first().hover()
  await expect(page.getByRole("dialog", { name: "Preview" })).toBeVisible({ timeout: 3000 })
  await collect()
  await page.mouse.move(0, 400)
  await pluginScreens(page, collect)
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible()
  await collect()
  await page.getByRole("dialog", { name: "Settings" }).getByRole("tab", { name: "Keymap" }).click()
  await expect(page.locator(".shortcut-list .shortcut-keys").first()).toBeVisible()
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
  const added = page.locator(".seqno-editor-content:focus")
  await expect(added).toHaveText("")
  await page.keyboard.type("/Scheduled")
  await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Please add some content first.")).toBeVisible()
  await collect()
  await expect(added).toHaveText("")
  await page.keyboard.insertText("{{embed [[Reading List]]}}")
  await expect(added).toHaveText("{{embed [[Reading List]]}}")
  await page.keyboard.press("Escape")
  await expect(page.locator(".seqno-embed-title").first()).toBeVisible({ timeout: 10_000 })
  await collect()
  await page.goto("/page/projects%2Fgreenhouse")
  await expect(page.locator(".seqno-references").first()).toBeVisible()
  await collect()
  await page.goto("/")
  await expect(page.locator(".seqno-journal").first()).toBeVisible()
  await collect()
  await listScreens(page, collect)
  await themeNamesScreens(page, collect)
  await pdfScreens(page, collect)
  await page.evaluate(() => {
    localStorage.setItem("seqno.theme", JSON.stringify("dark"))
    localStorage.setItem("seqno.accentColor", JSON.stringify("blue"))
  })
  await page.goto("/page/theme%20names")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.locator(".cm-s-lsradix")).toHaveCount(5)
  await expect(page.getByRole("main").locator(".seqno-codeblock")).toHaveCount(5)
  await collect()
  await page.goto("/")
  await expect(page.locator(".seqno-journal").first()).toBeVisible()
  await collect()
  const platforms = new Set([".is-mac", ".is-win32", ".is-linux"])
  expect([...platforms].filter((name) => rendered.has(name))).toHaveLength(1)

  const missing = [...themesSelect()]
    .filter((name) => !rendered.has(name) && !platforms.has(name))
    .toSorted()

  expect(missing).toEqual(Object.keys(gaps))
})
