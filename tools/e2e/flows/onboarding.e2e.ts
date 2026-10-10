import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { loadGraphFolder } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const leftSidebar = (page: Page) => page.getByRole("complementary", { name: "Left sidebar" })

const tip = (page: Page) => page.getByRole("note", { name: "Tip" })

test("a first visit offers both demo graphs before any graph opens", async ({ page }) => {
  await page.goto("/")
  const welcome = page.getByRole("heading", { level: 1, name: "Welcome to seqno" })
  await expect(welcome).toBeVisible()
  await expect(page.getByRole("list", { name: "Welcome to seqno" }).getByRole("button")).toHaveText(
    [/^Getting started/, /^Developer graph/],
  )
  await expect(
    page.getByRole("button", { name: "Getting started", exact: true }),
  ).toHaveAccessibleDescription("A short tour of how seqno works.")
  await expect(
    page.getByRole("button", { name: "Developer graph", exact: true }),
  ).toHaveAccessibleDescription("A developer's real notes, distilled from Bassim's prompt history.")
  await expect(page.getByRole("button", { name: "Open a folder" })).toBeVisible()
  await expect(page.getByRole("main")).toHaveCount(0)
})

test("the chooser and the help menu lead back to the seqno homepage, in the same tab", async ({
  page,
}) => {
  await page.route("https://seqno.vercel.app/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>seqno home</title>" }),
  )
  await page.goto("/")
  const about = page.getByRole("link", { name: "What is seqno?" })
  await expect(about).toHaveAttribute("href", "https://seqno.vercel.app")
  await expect(about).not.toHaveAttribute("target", /.+/)
  await page.getByRole("button", { name: "Getting started", exact: true }).click()
  await expect(page.getByRole("main")).not.toBeEmpty()
  await page.getByRole("button", { name: "Help" }).click()
  await page.getByRole("menuitem", { name: "About seqno" }).click()
  await expect(page).toHaveURL("https://seqno.vercel.app/")
  await expect(page).toHaveTitle("seqno home")
})

test("the chooser opens Getting started on today's journal", async ({ page, seqno }) => {
  await openDemo(page)
  await expect(seqno.today.getByRole("treeitem").first()).toBeVisible()
  await page.getByRole("button", { name: "Toggle left sidebar" }).click()
  await expect(leftSidebar(page).getByRole("button", { name: "Getting started" })).toBeVisible()
})

test("the chooser opens the Developer graph, and a reload goes straight back to it", async ({
  page,
  seqno,
}) => {
  await openDemo(page, "/", "Developer graph")
  await expect(seqno.today.getByRole("treeitem").first()).toBeVisible()
  await page.getByRole("button", { name: "Toggle left sidebar" }).click()
  const switcher = leftSidebar(page).getByRole("button", { name: "Developer graph" })
  await expect(switcher).toBeVisible()
  await page.reload()
  await expect(switcher).toBeVisible()
  await expect(page.getByRole("heading", { name: "Welcome to seqno" })).toHaveCount(0)
})

test("the graph menu lists both demo graphs under Demo graphs, whichever one is open", async ({
  page,
}) => {
  await openDemo(page)
  await page.getByRole("button", { name: "Toggle left sidebar" }).click()
  const sidebar = leftSidebar(page)
  const menu = page.getByRole("menu", { name: "Graphs" })
  const demos = menu.getByRole("menuitemradio")
  await sidebar.getByRole("button", { name: "Getting started" }).click()
  await expect(menu.getByText("Demo graphs", { exact: true })).toBeVisible()
  await expect(demos).toHaveText(["Getting started", "Developer graph"])
  await expect(demos.filter({ hasText: "Getting started" })).toBeChecked()
  await demos.filter({ hasText: "Developer graph" }).click()
  await sidebar.getByRole("button", { name: "Developer graph" }).click()
  await expect(demos).toHaveText(["Getting started", "Developer graph"])
  await expect(demos.filter({ hasText: "Developer graph" })).toBeChecked()
  await demos.filter({ hasText: "Getting started" }).click()
  await expect(sidebar.getByRole("button", { name: "Getting started" })).toBeVisible()
})

test("a returning visitor gets the new demo content once its version is newer", async ({
  page,
  seqno,
}) => {
  await openDemo(page)
  const first = seqno.today.getByRole("treeitem").first()
  await expect(first).not.toHaveText("")
  const shipped = (await first.textContent()) ?? ""
  await first.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" and my edit")
  await page.keyboard.press("Escape")
  await expect(first).toHaveText(`${shipped} and my edit`)
  await seqno.saved()
  await page.reload()
  await expect(first).toHaveText(`${shipped} and my edit`)
  await page.evaluate(async () => {
    const graphs = await (await navigator.storage.getDirectory()).getDirectoryHandle("graphs")
    const stamp = await (await graphs.getDirectoryHandle("demo")).getFileHandle("starter-version")
    const writable = await stamp.createWritable()
    await writable.write("0")
    await writable.close()
  })
  await page.reload()
  await expect(first).toHaveText(shipped)
})

test.describe("tips in a demo graph", () => {
  test.use({ hints: true })

  test("the graph menu tip appears when the graph opens and stays dismissed after a reload", async ({
    page,
  }) => {
    await openDemo(page)
    await expect(tip(page)).toHaveText(
      "This is the Getting started graph. Switch graphs from the left sidebar.",
    )
    await page.getByRole("button", { name: "Toggle left sidebar" }).click()
    await expect(tip(page)).toHaveText("This is the Getting started graph. Switch graphs here.")
    await tip(page).getByRole("button", { name: "Dismiss tip" }).click()
    await expect(tip(page)).toHaveText("Click to open this page.")
    await page.reload()
    await expect(tip(page)).toHaveText("Click to open this page.")
    await page.getByRole("button", { name: "Help" }).click()
    await page.getByRole("menuitem", { name: "Show tips again" }).click()
    await expect(tip(page)).toHaveText("This is the Getting started graph. Switch graphs here.")
  })

  test("each tip goes once you do what it says, and none covers a block being edited", async ({
    page,
    seqno,
  }) => {
    await openDemo(page)
    await expect(tip(page)).toHaveText(/from the left sidebar\.$/)
    await page.getByRole("button", { name: "Toggle left sidebar" }).click()
    await expect(tip(page)).toHaveText(/Switch graphs here\.$/)
    await leftSidebar(page).getByRole("button", { name: "Getting started" }).focus()
    await page.keyboard.press("ArrowDown")
    await expect(page.getByRole("menu", { name: "Graphs" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(tip(page)).toHaveText("Click to open this page.")
    await seqno.today.getByRole("treeitem").first().click()
    await expect(tip(page)).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(tip(page)).toHaveText("Click to open this page.")
    await page.getByRole("main").locator(".seqno-journal .seqno-pageref-link").first().click()
    await expect(page).toHaveURL(/\/page\//)
    await expect(tip(page)).toHaveText(
      "Shift-click a link to open it in the sidebar, next to this page.",
    )
    await page
      .getByRole("main")
      .locator(".seqno-page-blocks .seqno-pageref-link")
      .first()
      .click({ modifiers: ["Shift"] })
    await expect(tip(page)).toHaveText(
      "Contents is a page you write yourself. Keep the links you use most here.",
    )
    await page
      .getByRole("complementary", { name: "Right sidebar" })
      .getByRole("button", { name: "Contents", exact: true })
      .click()
    await expect(tip(page)).not.toHaveText(/^Contents/)
  })

  test("a folder of your own never shows tips", async ({ page }, testInfo) => {
    const graph = testInfo.outputPath("my-notes")
    await mkdir(join(graph, "pages"), { recursive: true })
    await writeFile(join(graph, "pages", "ideas.md"), "- links to [[Reading]]")
    await loadGraphFolder(page, graph)
    await page.goto("/")
    await page.getByRole("button", { name: "Open a folder" }).click()
    await expect(page.getByRole("button", { name: "Toggle left sidebar" })).toBeVisible()
    await page.getByRole("button", { name: "Help" }).click()
    await expect(page.getByRole("menuitem", { name: "Keyboard shortcuts" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Show tips again" })).toHaveCount(0)
    await expect(tip(page)).toHaveCount(0)
  })
})
