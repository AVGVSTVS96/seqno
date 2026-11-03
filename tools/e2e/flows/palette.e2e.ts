import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const palette = (page: Page) => page.getByRole("dialog", { name: "Search" })

const searchbox = (page: Page) => palette(page).getByRole("searchbox", { name: "Search" })

const commandList = (page: Page) => palette(page).getByRole("listbox", { name: "Commands" })

test("Mod+Shift+P lists Logseq's commands with their keys, runs one, and puts the most used first", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  await expect(palette(page).getByText("Search only:")).toBeVisible()
  await expect(palette(page).getByText("Commands", { exact: true }).first()).toBeVisible()
  const first = commandList(page).getByRole("option").first()
  await expect(first).toHaveText("Toggle wide modeTW")
  await expect(palette(page).getByRole("button", { name: /^Trigger/ })).toBeVisible()
  await searchbox(page).fill("right sidebar")
  await expect(commandList(page).getByRole("option")).toHaveText([
    "Toggle right sidebarTR",
    "Clear all in the right sidebar",
    /^Open today's page in the right sidebar/,
    "Closes the top item in the right sidebarCT",
  ])
  await page.keyboard.press("Enter")
  await expect(palette(page)).toHaveCount(0)
  await expect(page.locator(".app")).toHaveAttribute("data-right-open", "true")
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  await expect(first).toHaveText("Toggle right sidebarTR")
  await page.keyboard.press("Escape")
  await expect(palette(page).getByText("Search only:")).toHaveCount(0)
  await expect(palette(page).getByRole("listbox", { name: "Recently updated" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(palette(page)).toHaveCount(0)
})

test("search lists matching commands next to pages, and a slash narrows the search to one kind", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await page.keyboard.press("ControlOrMeta+k")
  await searchbox(page).fill("toggle")
  await expect(commandList(page).getByRole("option")).toHaveCount(5)
  await expect(palette(page).getByRole("listbox", { name: "Filters" })).toBeVisible()
  await searchbox(page).fill("/com")
  await expect(palette(page).getByRole("option")).toHaveText([
    "Search only commands — Add filter to search",
  ])
  await page.keyboard.press("Enter")
  await expect(searchbox(page)).toHaveValue("")
  await expect(palette(page).getByText("Search only:")).toBeVisible()
  await searchbox(page).fill("wide")
  await expect(palette(page).getByRole("option")).toHaveText(["Toggle wide modeTW"])
  await page.keyboard.press("Enter")
  await expect(page.locator(".app")).toHaveAttribute("data-wide", "true")
})

test("Search blocks in page finds blocks on the open page only", async ({ page }) => {
  await openDemo(page, "/page/tasks")
  await page.keyboard.press("ControlOrMeta+k")
  await searchbox(page).fill("compost")
  await expect(
    palette(page).getByRole("listbox", { name: "Nodes" }).getByRole("option"),
  ).not.toHaveCount(1)
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.keyboard.press("ControlOrMeta+Shift+KeyK")
  await expect(palette(page).getByText("Current page", { exact: true }).first()).toBeVisible()
  await searchbox(page).fill("compost")
  const found = palette(page).getByRole("listbox", { name: "Current page" }).getByRole("option")
  await expect(found).toHaveCount(1)
  await expect(found).toContainText("Build a second compost bin")
})

test("a command from the palette acts on the selected blocks", async ({ page, seqno }) => {
  await seqno.openDemoGraph()
  const rain = seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" })
  await rain.click()
  await page.keyboard.press("Escape")
  await expect(rain).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  await searchbox(page).fill("rotate")
  await page.keyboard.press("Enter")
  await expect(rain.getByText("TODO", { exact: true })).toBeVisible()
  await expect(rain).toHaveAttribute("aria-selected", "true")
})

test("the page menu lives in More and on the page title, and makes a page public", async ({
  page,
}) => {
  await openDemo(page, "/page/ideas")
  await page.getByRole("button", { name: "More" }).click()
  const more = page.getByRole("menu", { name: "More" })
  await expect(more.getByRole("menuitem")).toHaveText([
    "Add to Favorites",
    "Copy page URL",
    "Delete page",
    "Export page",
    "Make it public for publishing",
    "Settings",
    "Plugins",
    "Appearance",
    "Export graph",
  ])
  await page.keyboard.press("Escape")
  await page.getByRole("heading", { name: "Ideas", level: 1 }).click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Page actions" })
  await menu.getByRole("menuitem", { name: "Make it public for publishing" }).click()
  await expect(menu).toHaveCount(0)
  await page.getByRole("heading", { name: "Ideas", level: 1 }).click({ button: "right" })
  await expect(menu.getByRole("menuitem", { name: "Make it private" })).toBeVisible()
  await menu.getByRole("menuitem", { name: "Add to Favorites" }).click()
  await page.getByRole("button", { name: "More" }).click()
  await expect(more.getByRole("menuitem", { name: "Unfavorite page" })).toBeVisible()
})
