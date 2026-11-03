import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { journalTitle } from "../src/journal.ts"
import { serveMarketplace } from "../src/plugins.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const openPlugins = async (page: Page) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()
  return page.getByRole("dialog", { name: "Plugins" })
}

const install = async (page: Page, name: string, kind: "Plugins" | "Themes" = "Plugins") => {
  const dialog = await openPlugins(page)
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  await dialog.getByRole("radio", { name: new RegExp(`^${kind}`) }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")
}

const keptCalendarFiles = (page: Page) => () =>
  page.evaluate(
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
  await expect(dialog.getByRole("radio", { name: "Plugins (10)" })).toBeVisible()
  await expect(dialog.getByRole("radio", { name: "Themes (5)" })).toBeVisible()
  await expect(dialog.getByRole("listitem")).toHaveCount(10)
  await expect(dialog.getByRole("listitem", { name: "Archivist" })).toHaveCount(1)
  await dialog.getByRole("searchbox", { name: "Search plugins" }).fill("calendar")
  await expect(dialog.getByRole("listitem")).toHaveCount(1)
  const card = dialog.getByRole("listitem", { name: "Journals calendar" })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await dialog.getByRole("tab", { name: "Installed" }).click()
  await dialog.getByRole("searchbox", { name: "Search plugins" }).fill("")
  await expect(dialog.getByRole("listitem")).toHaveCount(1)
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
  await expect(calendar).toHaveClass(/visible/)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  await page
    .frameLocator("#logseq-journals-calendar_iframe")
    .locator(`.id-${iso(yesterday)} .vc-day-content`)
    .click()
  await expect(page.getByRole("heading", { name: journalTitle(yesterday), level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/page\//)
  await expect(calendar).not.toHaveClass(/visible/)
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
  await page.keyboard.type("Beds /word")
  await page.getByRole("option", { name: "Word count" }).click()
  await expect(seqno.editor).toHaveText(/^Beds \{\{renderer :wordcount_[0-9a-f-]+\}\}$/)
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
  await expect(page.locator("#logseq-markdown-table_lsp_main")).not.toHaveClass(/visible/)
  await expect(seqno.today.getByRole("treeitem").filter({ hasText: "pear" })).toHaveCount(1)
  await expect(seqno.today.getByRole("treeitem").filter({ hasText: "apple" })).toHaveCount(0)
})

test("a marketplace theme restyles seqno through Logseq's variables, and the default theme undoes it", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  const font = () => page.evaluate(() => getComputedStyle(document.body).fontFamily)
  await expect.poll(font).toMatch(/^"Inter Variable"/)
  await install(page, "Dev theme", "Themes")
  const dialog = await openPlugins(page)
  await dialog.getByRole("radio", { name: /^Themes/ }).click()
  await dialog.getByRole("radio", { name: "Dev theme", exact: true }).click()
  await expect.poll(font).not.toMatch(/^"Inter Variable"/)
  await page.reload()
  await expect.poll(font).not.toMatch(/^"Inter Variable"/)
  const again = await openPlugins(page)
  await again.getByRole("radio", { name: /^Themes/ }).click()
  await again.getByRole("radio", { name: "Logseq default theme" }).click()
  await expect.poll(font).toMatch(/^"Inter Variable"/)
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
  await expect(dialog.getByRole("listitem")).toHaveCount(0)
  await expect(button).toHaveCount(0)
  await expect(page.locator("#logseq-journals-calendar_lsp_main")).toHaveCount(0)
  await expect.poll(keptCalendarFiles(page)).toBe(0)
})

test("installed plugins and themes keep working offline, after a reload", async ({
  page,
  context,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Journals calendar")
  await install(page, "logseq-wordcount-plugin")
  await install(page, "Dev theme", "Themes")
  const dialog = await openPlugins(page)
  await dialog.getByRole("radio", { name: /^Themes/ }).click()
  await dialog.getByRole("radio", { name: "Dev theme", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.unrouteAll()
  await context.route("**", (route) => route.abort("internetdisconnected"))
  await context.setOffline(true)
  await page.reload()
  const font = () => page.evaluate(() => getComputedStyle(document.body).fontFamily)
  await expect.poll(font).toMatch(/^"Only Emoji", "Source Sans 3 VF"/)
  await page.locator("#open-calendar-button").click()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  await page
    .frameLocator("#logseq-journals-calendar_iframe")
    .locator(`.id-${iso(yesterday)} .vc-day-content`)
    .click()
  await expect(page.getByRole("heading", { name: journalTitle(yesterday), level: 1 })).toBeVisible()
  await page.goBack()
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.type("Beds /word")
  await page.getByRole("option", { name: "Word count" }).click()
  await expect(seqno.editor).toHaveText(/^Beds \{\{renderer :wordcount_[0-9a-f-]+\}\}$/)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Tab")
  await page.keyboard.type("one two three")
  await page.keyboard.press("Escape")
  await expect(
    seqno.today.getByRole("treeitem").filter({ hasText: "Beds" }).locator(".wordcount-btn"),
  ).toHaveText("Words: 3")
})
