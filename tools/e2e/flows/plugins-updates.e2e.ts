import type { BrowserContext, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { openPlugins, serveMarketplace, serveOlderVersion } from "../src/plugins.ts"
import { expect, test, todayOn } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const wordcount = "benjypng/logseq-wordcount-plugin"

const install = async (page: Page, name: string) => {
  const dialog = await openPlugins(page)
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")
}

const keptVersions = (page: Page) => async () =>
  await page.evaluate(async () =>
    [
      ...new Set(
        (await (await caches.open("seqno-plugins")).keys()).flatMap(
          (request) => /\/logseq-wordcount-plugin\/([^/]+)\//u.exec(request.url)?.[1] ?? [],
        ),
      ),
    ].toSorted(),
  )

const countWords = async (page: Page) => {
  await todayOn(page).getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  const editor = page.getByRole("treeitem").getByRole("textbox")
  await expect(editor).toHaveText("")
  await page.keyboard.type("Beds /word")
  await page.getByRole("option", { name: "Word count" }).click()
  await expect(editor).toHaveText(/^Beds \{\{renderer :wordcount_[0-9a-f-]+\}\}$/u)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Tab")
  await page.keyboard.type("one two three")
  await page.keyboard.press("Escape")
}

const wordCount = (page: Page) =>
  todayOn(page).getByRole("treeitem").filter({ hasText: "Beds" }).locator(".wordcount-btn")

const checksOf = (context: BrowserContext) => {
  const checks: string[] = []
  context.on("request", (request) => {
    if (request.url().startsWith("https://plugins.logseq.io/r2/")) {
      checks.push(request.url())
    }
  })

  return checks
}

test("Check all updates finds a plugin's newer version, and Update all of selected swaps its offline copy for the new one, which keeps its settings and works offline after a reload", async ({
  page,
  context,
  seqno,
}) => {
  test.slow()
  await seqno.openDemoGraph()
  await expect
    .poll(async () => await page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
  const releaseNewest = await serveOlderVersion(context, wordcount, "v2.4.2")
  await install(page, "logseq-wordcount-plugin")
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => localStorage.getItem("seqno.plugins.settings.logseq-wordcount-plugin") ?? "",
        ),
    )
    .toContain('"wordCountStr":"Words:"')
  const dialog = await openPlugins(page)
  const card = dialog.getByRole("listitem", { name: "logseq-wordcount-plugin" })
  await expect(card.getByRole("heading")).toHaveText("logseq-wordcount-pluginv2.4.2")
  await dialog.getByRole("button", { name: "logseq-wordcount-plugin settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  await settings.getByRole("textbox", { name: "Customise word count text" }).fill("Mots:")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await countWords(page)
  await expect(wordCount(page)).toHaveText("Mots: 3")
  await expect.poll(keptVersions(page)).toEqual(["v2.4.2"])

  await releaseNewest()
  await openPlugins(page)
  await dialog.getByRole("button", { name: "Plugin actions" }).click()
  await page.getByRole("menuitem", { name: "Check all updates" }).click()
  const updates = page.getByRole("dialog", { name: "Plugin updates" })
  await expect(updates.getByRole("heading")).toHaveText("Found 1 updates")
  await expect(updates.getByRole("listitem")).toHaveText([
    "logseq-wordcount-pluginv2.4.2 👉 v2.4.3",
  ])
  await expect(updates.getByRole("checkbox")).toBeChecked()
  await updates.getByRole("button", { name: "Update all of selected" }).click()
  await expect(updates.getByText("🎉 All updated!")).toBeVisible()
  await expect(page.getByText("Update plugin: logseq-wordcount-plugin - v2.4.3")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(card.getByRole("heading")).toHaveText("logseq-wordcount-pluginv2.4.3")
  await expect(
    card.getByRole("button", { name: "Check update logseq-wordcount-plugin" }),
  ).toHaveText("Check update")
  await expect.poll(keptVersions(page)).toEqual(["v2.4.3"])
  await page.keyboard.press("Escape")
  await expect(wordCount(page)).toHaveText("Mots: 3")

  await context.unrouteAll()
  await context.route("**", async (route) => {
    await route.abort("internetdisconnected")
  })
  await context.setOffline(true)
  await page.reload()
  await expect(wordCount(page)).toHaveText("Mots: 3")
  expect(
    page.frame({ url: /\/lsp\/benjypng\/logseq-wordcount-plugin\/v2\.4\.3\//u }),
  ).not.toBeNull()
  const again = await openPlugins(page)
  await again.getByRole("button", { name: "logseq-wordcount-plugin settings" }).click()
  await expect(settings.getByRole("textbox", { name: "Customise word count text" })).toHaveValue(
    "Mots:",
  )
})

test("the auto check finds updates on start once 12 hours have passed, the puzzle button's red dot and New updates show them, a card's button updates one, and the switch turns the check off", async ({
  page,
  context,
  seqno,
}) => {
  await seqno.openDemoGraph()
  const releaseNewest = await serveOlderVersion(context, wordcount, "v2.4.2")
  await install(page, "Journals calendar")
  await install(page, "logseq-wordcount-plugin")
  await releaseNewest()
  const stale = Date.now() - 13 * 60 * 60 * 1000
  await page.evaluate((at) => {
    localStorage.setItem("seqno.plugins.lastAutoUpdates", JSON.stringify(at))
  }, stale)
  await page.reload()
  const puzzle = page.getByRole("button", { name: "Plugin toolbar items" })
  await expect(puzzle.locator(".plugin-updates-point")).toBeVisible()
  await expect
    .poll(
      async () =>
        await page.evaluate(() => Number(localStorage.getItem("seqno.plugins.lastAutoUpdates"))),
    )
    .toBeGreaterThan(stale)
  await puzzle.click()
  const menu = page.getByRole("menu", { name: "Plugin toolbar items" })
  await expect(
    menu.getByRole("menuitemcheckbox", { name: "Auto check for updates" }),
  ).toHaveAttribute("aria-checked", "true")
  await menu.getByRole("menuitem", { name: "New updates" }).click()
  const updates = page.getByRole("dialog", { name: "Plugin updates" })
  await expect(updates.getByRole("listitem")).toHaveText([
    "logseq-wordcount-pluginv2.4.2 👉 v2.4.3",
  ])
  await updates.getByRole("checkbox").uncheck()
  await expect(updates.getByRole("button", { name: "Update all of selected" })).toBeDisabled()
  await page.keyboard.press("Escape")

  const dialog = await openPlugins(page)
  const card = dialog.getByRole("listitem", { name: "logseq-wordcount-plugin" })
  const update = card.getByRole("button", { name: "Update logseq-wordcount-plugin" })
  await expect(update).toHaveText("Update 👉 v2.4.3")
  await update.click()
  await expect(page.getByText("Update plugin: logseq-wordcount-plugin - v2.4.3")).toBeVisible()
  await expect(card.getByRole("heading")).toHaveText("logseq-wordcount-pluginv2.4.3")
  await card.getByRole("button", { name: "Check update logseq-wordcount-plugin" }).click()
  await expect(page.getByText("<logseq-wordcount-plugin> It's up to date :)")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(puzzle.locator(".plugin-updates-point")).toHaveCount(0)

  await puzzle.click()
  await expect(menu.getByRole("menuitem", { name: "New updates" })).toHaveCount(0)
  const auto = menu.getByRole("menuitemcheckbox", { name: "Auto check for updates" })
  await auto.click()
  await expect(auto).toHaveAttribute("aria-checked", "false")
  await expect(page.getByText("Auto check for updates OFF!")).toBeVisible()
  await expect
    .poll(
      async () => await page.evaluate(() => localStorage.getItem("seqno.plugins.lastAutoUpdates")),
    )
    .toBe("false")
  const checks = checksOf(context)
  await page.reload()
  await expect(page.locator("#open-calendar-button")).toBeVisible()
  await puzzle.click()
  await expect(auto).toHaveAttribute("aria-checked", "false")
  expect(checks).toEqual([])
})

const capOf = async (page: Page) =>
  await page.evaluate(() => {
    const [main, left, right, row] = [
      ".main-content-container",
      "header > .head-left",
      "header > .head-right",
      ".plugin-toolbar-list",
    ].map((selector) => document.querySelector<HTMLElement>(selector))

    const others = [...(right?.children ?? [])]
      .filter((child) => !child.matches(".plugin-toolbar, [popover]"))
      .reduce((sum, child) => sum + (child instanceof HTMLElement ? child.offsetWidth : 0), 0)

    const leftOpen = localStorage.getItem("seqno.leftSidebar") === "true"
    const room = (main?.offsetWidth ?? 0) - (leftOpen ? 0 : (left?.offsetWidth ?? 0))

    return { expected: `${Math.max(room - others - 100, 76)}px`, actual: row?.style.maxWidth }
  })

test("a crowded header caps the plugin buttons' row as Logseq does, at the room beside the other buttons less 100px and never under 76px, through window and sidebar resizes", async ({
  page,
  seqno,
}) => {
  test.slow()
  await page.setViewportSize({ width: 520, height: 800 })
  await seqno.openDemoGraph()

  for (const name of [
    "Journals calendar",
    "logseq-pomodoro-timer",
    "Quick Capture",
    "Random Note",
    "GitSeq",
    "Hypothesis",
  ]) {
    await install(page, name)
  }

  const row = page.getByRole("banner").locator(".plugin-toolbar-list")
  await expect(row.locator("[data-injected-ui]")).toHaveCount(9)
  const cap = async () => await capOf(page).then(({ actual }) => actual)
  await expect.poll(cap).toBe("284px")
  expect(await capOf(page)).toEqual({ expected: "284px", actual: "284px" })
  expect(await row.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)

  await page.setViewportSize({ width: 800, height: 800 })
  await expect.poll(cap).toBe("564px")

  await page.getByRole("button", { name: "Toggle right sidebar" }).click()
  await expect.poll(cap).toBe("244px")
  expect(await capOf(page)).toEqual({ expected: "244px", actual: "244px" })

  await page.setViewportSize({ width: 360, height: 800 })
  await expect.poll(cap).toBe("76px")
})
