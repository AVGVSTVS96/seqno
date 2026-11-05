import type { BrowserContext, Locator, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { journalTitle } from "../src/journal.ts"
import { serveMarketplace } from "../src/plugins.ts"
import { expect, test, todayOn } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const openPlugins = async (page: Page) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()

  return page.getByRole("dialog", { name: "Plugins" })
}

const cardsOf = (dialog: Locator) =>
  dialog.getByRole("listitem").filter({ has: dialog.page().getByRole("heading") })

const install = async (page: Page, name: string, kind: "Plugins" | "Themes" = "Plugins") => {
  const dialog = await openPlugins(page)
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  await dialog.getByRole("radio", { name: new RegExp(`^${kind}`) }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")
}

const keptCalendarFiles = (page: Page) => async () =>
  await page.evaluate(
    async () =>
      (await (await caches.open("seqno-plugins")).keys()).filter((request) =>
        request.url.includes("/logseq-journals-calendar/"),
      ).length,
  )

const iso = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`

test("the marketplace lists plugins, desktop-only ones too, and themes, and Install adds one to Installed", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  const dialog = await openPlugins(page)
  await expect(dialog.getByRole("tab", { name: "Installed" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(dialog.getByText("Nothing found.")).toBeVisible()
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  await expect(dialog.getByRole("radio", { name: "Plugins (18)" })).toBeVisible()
  await expect(dialog.getByRole("radio", { name: "Themes (5)" })).toBeVisible()
  await expect(cardsOf(dialog)).toHaveCount(18)
  await expect(dialog.getByRole("listitem", { name: "Archivist" })).toHaveCount(1)
  await dialog.getByRole("searchbox", { name: "Search plugins" }).fill("calendar")
  await expect(cardsOf(dialog)).toHaveCount(1)
  const card = dialog.getByRole("listitem", { name: "Journals calendar" })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await dialog.getByRole("tab", { name: "Installed" }).click()
  await dialog.getByRole("searchbox", { name: "Search plugins" }).fill("")
  await expect(cardsOf(dialog)).toHaveCount(1)
  await expect(dialog.getByRole("switch", { name: "Enable Journals calendar" })).toHaveAttribute(
    "aria-checked",
    "true",
  )
})

test("Journals calendar's toolbar button opens its calendar, and a day opens that journal", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Journals calendar")
  await page.locator("#open-calendar-button").click()
  const calendar = page.locator("#logseq-journals-calendar_lsp_main")
  await expect(calendar).toHaveClass(/visible/u)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  await page
    .frameLocator("#logseq-journals-calendar_iframe")
    .locator(`.id-${iso(yesterday)} .vc-day-content`)
    .click()
  await expect(page.getByRole("heading", { name: journalTitle(yesterday), level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/page\//u)
  await expect(calendar).not.toHaveClass(/visible/u)
})

test("the puzzle menu lists every plugin's toolbar item with a pin: pinned ones stay in the header, the rest move into the menu", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Journals calendar")
  await install(page, "logseq-pomodoro-timer")
  const header = page.getByRole("banner").locator(".list-wrap")
  await expect(header.locator("#open-calendar-button")).toBeVisible()
  await expect(header.locator("#logseq-pomodoro-timer--pomodoro_timer")).toHaveText("25:00")
  await page.getByRole("button", { name: "Plugin toolbar items" }).click()
  const menu = page.getByRole("menu", { name: "Plugin toolbar items" })
  const calendar = menu.getByRole("menuitemcheckbox", { name: "open-calendar" })
  const timer = menu.getByRole("menuitemcheckbox", { name: "pomodoro_timer" })
  await expect(calendar).toHaveAttribute("aria-checked", "false")
  await expect(timer).toHaveAttribute("aria-checked", "false")
  await expect(timer.locator("#logseq-pomodoro-timer--pl-pomodoro_timer")).toHaveText("25:00")
  await calendar.click()
  await expect(calendar).toHaveAttribute("aria-checked", "true")
  await expect(menu).toBeVisible()
  await expect(header.locator("#open-calendar-button")).toBeVisible()
  await expect(header.locator("#logseq-pomodoro-timer--pomodoro_timer")).toHaveCount(0)
  await timer.locator("[data-injected-ui]").click()
  await expect(timer).toHaveAttribute("aria-checked", "false")
  await page.keyboard.press("Escape")
  await page.reload()
  await expect(header.locator("#open-calendar-button")).toBeVisible()
  await expect(header.locator("#logseq-pomodoro-timer--pomodoro_timer")).toHaveCount(0)
  await page.getByRole("button", { name: "Plugin toolbar items" }).click()
  await expect(calendar).toHaveAttribute("aria-checked", "true")
  await calendar.press("Enter")
  await expect(calendar).toHaveAttribute("aria-checked", "false")
  await expect(header.locator("[data-injected-ui]")).toHaveCount(0)
  await menu.getByRole("menuitem", { name: "Settings" }).click()
  await expect(page.getByRole("dialog", { name: "Plugin settings" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Plugin toolbar items" }).click()
  await menu.getByRole("menuitem", { name: "Plugins" }).click()
  await expect(page.getByRole("dialog", { name: "Plugins" })).toBeVisible()
})

test("Word count's slash command puts a live count in the block, which follows edits below it", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "logseq-wordcount-plugin")
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(seqno.editor).toHaveText("")
  await page.keyboard.type("Beds /word")
  await page.getByRole("option", { name: "Word count" }).click()
  await expect(seqno.editor).toHaveText(/^Beds \{\{renderer :wordcount_[0-9a-f-]+\}\}$/u)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Tab")
  await page.keyboard.type("one two three")
  await page.keyboard.press("Escape")

  const count = seqno.today
    .getByRole("treeitem")
    .filter({ hasText: "Beds" })
    .locator(".wordcount-btn")

  await expect(count).toHaveText("Words: 3")
  await seqno.today.getByRole("treeitem").filter({ hasText: "one two three" }).click()
  await page.keyboard.press("End")
  await page.keyboard.type(" four five")
  await page.keyboard.press("Escape")
  await expect(count).toHaveText("Words: 5")
})

test("Pomodoro's toolbar runs its timer, and its settings change the next timer", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "logseq-pomodoro-timer")
  const timer = page.locator("#logseq-pomodoro-timer--pomodoro_timer")
  await expect(timer).toHaveText("25:00")
  await page.locator('[data-on-click="toggleStopped"]').click()
  await expect(timer).not.toHaveText("25:00")
  await page.locator('[data-on-click="stopPomodoro"]').click()
  const dialog = await openPlugins(page)
  await dialog.getByRole("button", { name: "logseq-pomodoro-timer settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  const length = settings.getByRole("spinbutton").first()
  await expect(length).toHaveValue("25")
  await length.fill("10")
  await page.reload()
  await expect(timer).toHaveText("10:00")
})

test("Markdown Table Editor opens from the block menu and writes the table back", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Markdown Table Editor")
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(seqno.editor).toHaveText("")
  await page.keyboard.type("|fruit|count|")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("|--|--|")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("|apple|3|")
  await page.keyboard.press("Escape")
  const row = seqno.today.getByRole("treeitem").filter({ hasText: "apple" })
  await row.getByRole("button", { name: "Zoom into block" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Markdown Table Editor" }).click()
  const editor = page.frameLocator("#logseq-markdown-table_iframe")
  await editor.getByText("apple", { exact: true }).dblclick()
  await expect(editor.getByRole("textbox")).toBeFocused()
  await page.keyboard.type("pear")
  await editor.getByRole("button", { name: "Confirm" }).click()
  await expect(page.locator("#logseq-markdown-table_lsp_main")).not.toHaveClass(/visible/u)
  await expect(seqno.today.getByRole("treeitem").filter({ hasText: "pear" })).toHaveCount(1)
  await expect(seqno.today.getByRole("treeitem").filter({ hasText: "apple" })).toHaveCount(0)
})

test("Random Note's commands are in the command palette with its keys, and run from there", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Random Note")
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  const palette = page.getByRole("dialog", { name: "Search" })
  await palette.getByRole("searchbox", { name: "Search" }).fill("random note")
  await expect(palette.getByRole("option")).toHaveText([
    "Random note => tags mode",
    "Random note => query mode",
    "Random note => page mode",
    "Random note => card mode",
    "Random note => Let's goRN",
  ])
  await palette.getByRole("option", { name: "Random note => query mode" }).click()
  await expect(palette).toHaveCount(0)
  const dialog = await openPlugins(page)
  await dialog.getByRole("button", { name: "Random Note settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  await expect(settings.getByRole("radio", { name: "query" })).toBeChecked()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  await expect(palette.getByRole("option").first()).toHaveText("Random note => query mode")
})

test("Markmap opens from the command palette and from its own keys, and draws the open page", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Markmap")
  await page.goto("/page/ideas")
  await expect(page.getByRole("heading", { name: "Ideas", level: 1 })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  const palette = page.getByRole("dialog", { name: "Search" })
  await palette.getByRole("searchbox", { name: "Search" }).fill("markmap")
  await expect(palette.getByRole("option")).toHaveText([
    "Open MarkmapCtrlMthenCtrlM",
    "Open Full MarkmapCtrlAlt⇧MthenCtrlAlt⇧M",
  ])
  await page.keyboard.press("Enter")
  const markmap = page.locator("#logseq-mark-map_lsp_main")
  await expect(markmap).toHaveClass(/visible/u)
  const drawn = page.frameLocator("#logseq-mark-map_iframe").locator("svg")
  await expect(drawn.getByText("Loose thoughts go here", { exact: false })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(markmap).not.toHaveClass(/visible/u)
  await page.keyboard.press("Control+m")
  await page.keyboard.press("Control+m")
  await expect(markmap).toHaveClass(/visible/u)
})

test("Merge Pages adds its item to the page menu, and merging moves a page's blocks into another", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "logseq-mergepages-plugin")
  await page.goto("/page/ideas")
  await page.getByRole("heading", { name: "Ideas", level: 1 }).click({ button: "right" })
  await page
    .getByRole("menu", { name: "Page actions" })
    .getByRole("menuitem", { name: "Merge Page With" })
    .click()
  const picker = page.frameLocator("#logseq-mergepages-plugin_iframe")
  const search = picker.getByPlaceholder("Search for a page to merge into...")
  await expect(search).toBeFocused()
  await search.pressSequentially("basil")
  await search.press("ArrowRight")
  await picker.getByText("BASIL", { exact: true }).click()
  await expect(page).toHaveURL(/\/page\/basil$/u)
  await expect(
    page.getByRole("treeitem").filter({ hasText: "Loose thoughts go here" }),
  ).toHaveCount(1)
  await page.getByRole("button", { name: "More" }).click()
  await expect(
    page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: "Merge Page With" }),
  ).toBeVisible()
})

test("a marketplace theme restyles seqno through Logseq's variables, and the default theme undoes it", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  const font = async () => await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  await expect.poll(font).toMatch(/^"Inter Variable"/u)
  await install(page, "Dev theme", "Themes")
  const dialog = await openPlugins(page)
  await dialog.getByRole("radio", { name: /^Themes/u }).click()
  await dialog.getByRole("radio", { name: "Dev theme", exact: true }).click()
  await expect.poll(font).not.toMatch(/^"Inter Variable"/u)
  await page.reload()
  await expect.poll(font).not.toMatch(/^"Inter Variable"/u)
  const again = await openPlugins(page)
  await again.getByRole("radio", { name: /^Themes/u }).click()
  await again.getByRole("radio", { name: "Logseq default theme" }).click()
  await expect.poll(font).toMatch(/^"Inter Variable"/u)
})

test("installed plugins load again after a reload, and turning one off or uninstalling removes its UI", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Journals calendar")
  const button = page.locator("#open-calendar-button")
  await expect(button).toBeVisible()
  await page.reload()
  await expect(button).toBeVisible()
  const dialog = await openPlugins(page)
  const enabled = dialog.getByRole("switch", { name: "Enable Journals calendar" })
  await enabled.click()
  await expect(enabled).toHaveAttribute("aria-checked", "false")
  await expect(button).toHaveCount(0)
  await enabled.click()
  await expect(button).toBeVisible()
  await expect.poll(keptCalendarFiles(page)).toBeGreaterThan(0)
  await dialog.getByRole("button", { name: "Uninstall Journals calendar" }).click()
  await expect(cardsOf(dialog)).toHaveCount(0)
  await expect(button).toHaveCount(0)
  await expect(page.locator("#logseq-journals-calendar_lsp_main")).toHaveCount(0)
  await expect.poll(keptCalendarFiles(page)).toBe(0)
})

test("installed plugins and themes keep working offline, with a theme's own font, after a reload", async ({
  page,
  context,
  seqno,
}) => {
  test.slow()
  await seqno.openDemoGraph()
  await expect
    .poll(async () => await page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
  await install(page, "Journals calendar")
  await install(page, "logseq-wordcount-plugin")
  await install(page, "Catppuccin", "Themes")
  await install(page, "Dev theme", "Themes")
  const dialog = await openPlugins(page)
  await dialog.getByRole("radio", { name: /^Themes/u }).click()
  await dialog.getByRole("radio", { name: "Dev theme", exact: true }).click()
  await page.keyboard.press("Escape")
  await context.unrouteAll()
  await context.route("**", async (route) => {
    await route.abort("internetdisconnected")
  })
  await context.setOffline(true)
  await page.reload()
  const font = async () => await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  await expect.poll(font).toMatch(/^"Only Emoji", "Source Sans 3 VF"/u)

  const themeFont = async () =>
    await page.evaluate(async () => (await document.fonts.load('16px "Source Sans 3 VF"')).length)

  await expect.poll(themeFont).toBeGreaterThan(0)

  const catppuccinSdk = () =>
    page
      .frame({ url: /\/lsp\/catppuccin\/logseq\//u })
      ?.evaluate(() => typeof Reflect.get(window, "logseq"))

  await expect.poll(catppuccinSdk).toBe("object")
  await page.locator("#open-calendar-button").click()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  await page
    .frameLocator("#logseq-journals-calendar_iframe")
    .locator(`.id-${iso(yesterday)} .vc-day-content`)
    .click()
  await expect(page.getByRole("heading", { name: journalTitle(yesterday), level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/page\//u)
  await page.goBack()
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(seqno.editor).toHaveText("")
  await page.keyboard.type("Beds /word")
  await page.getByRole("option", { name: "Word count" }).click()
  await expect(seqno.editor).toHaveText(/^Beds \{\{renderer :wordcount_[0-9a-f-]+\}\}$/u)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Tab")
  await page.keyboard.type("one two three")
  await page.keyboard.press("Escape")
  await expect(
    seqno.today.getByRole("treeitem").filter({ hasText: "Beds" }).locator(".wordcount-btn"),
  ).toHaveText("Words: 3")
})

const writeCalls = [
  "update_block",
  "upsert_block_property",
  "remove_block_property",
  "insert_block",
]

const countPluginWrites = async (context: BrowserContext) =>
  await context.addInitScript((methods) => {
    if (window !== window.top) {
      return
    }

    const writes: string[] = []
    Reflect.set(window, "pluginWrites", writes)
    addEventListener("message", (event: MessageEvent<unknown>) => {
      const call = Reflect.get(Object(Reflect.get(Object(event.data), "value")), "data")
      const method = String(Reflect.get(Object(Reflect.get(Object(call), "payload")), "method"))
      const name = method.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)

      if (Reflect.get(Object(call), "type") === "api:call" && methods.includes(name)) {
        writes.push(name)
      }
    })
  }, writeCalls)

const markDone = async (tab: Page, text: string) => {
  const today = todayOn(tab)
  await today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).first().click()
  await tab.keyboard.press("End")
  await tab.keyboard.press("Enter")
  await expect(tab.getByRole("treeitem").getByRole("textbox")).toHaveText("")
  await tab.keyboard.type(`TODO ${text}`)
  await tab.keyboard.press("Escape")
  await today
    .getByRole("treeitem")
    .filter({ hasText: text })
    .getByRole("checkbox", { name: "Mark as done" })
    .click()
}

const doneTime = (tab: Page, text: string) =>
  todayOn(tab)
    .getByRole("treeitem")
    .filter({ hasText: text })
    .getByText(/^done-ms/u)

const pluginWrites = (page: Page) => async () =>
  await page.evaluate(() => Reflect.get(window, "pluginWrites"))

test("with two tabs open, a plugin that writes on every change writes once per change", async ({
  page,
  context,
  seqno,
}) => {
  await countPluginWrites(context)
  await seqno.openDemoGraph()
  await install(page, "DONE time")
  await install(page, "Journals calendar")
  const other = await context.newPage()
  await other.goto("/")
  const otherToday = todayOn(other)
  await expect(otherToday).toBeVisible()
  await expect(other.locator("#open-calendar-button")).toBeVisible()

  await markDone(other, "Sow radishes")
  await expect(doneTime(other, "Sow radishes")).toBeVisible()
  await expect(doneTime(page, "Sow radishes")).toBeVisible()
  await markDone(page, "Turn the compost")
  await expect(doneTime(page, "Turn the compost")).toBeVisible()
  await expect(doneTime(other, "Turn the compost")).toBeVisible()
  await page.waitForTimeout(1000)
  expect(await pluginWrites(page)()).toEqual(["upsert_block_property"])
  expect(await pluginWrites(other)()).toEqual(["upsert_block_property"])

  await other.locator("#open-calendar-button").click()
  await expect(other.locator("#logseq-journals-calendar_lsp_main")).toHaveClass(/visible/u)
})
