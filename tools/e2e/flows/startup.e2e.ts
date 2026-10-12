import { rm } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { materializeShowcase } from "../design/showcase.ts"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const beds = "Beds run north to south so neither row shades the other."

const showsPages = async (page: Page, count: string) => {
  await page.goto("/all-pages")
  await expect(page.locator(".seqno-view-count")).toHaveText(count)
}

test("the app opens the last graph on every load and a reload keeps the route", async ({
  page,
}) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await openDemo(page, "/page/garden%20plan")
  const title = page.getByRole("main").getByRole("heading", { level: 1, name: "Garden Plan" })
  await expect(title).toBeVisible()
  await expect(page).toHaveTitle("Garden Plan")
  await page.reload()
  await expect(title).toBeVisible()
  await expect(page).toHaveURL(/\/page\/garden%20plan$/)
  await expect(page.getByRole("heading", { name: "Welcome to seqno" })).toHaveCount(0)
})

test("all graphs is a page in the shell, reached from the graph switcher", async ({ page }) => {
  await openDemo(page)
  await page.getByRole("button", { name: "Toggle left sidebar" }).click()
  await page.getByRole("button", { name: "Getting started" }).click()
  await page.getByRole("menuitem", { name: "All graphs" }).click()
  await expect(page).toHaveURL(/\/graphs$/)
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: "All graphs" })).toBeVisible()
  await expect(main.getByRole("button", { name: "Getting started", exact: true })).toBeVisible()
  await expect(main.getByText(/^Last opened at: /)).toBeVisible()
  await expect(page.getByRole("banner")).toBeVisible()
})

test("Ctrl+Z after a reload undoes only the last edit", async ({ page, seqno }) => {
  await seedOpfs(page, fixtureGraph("graphs/showcase"), ["graphs", "demo"])
  await openDemo(page, "/all-pages")
  await showsPages(page, "14")
  await page.goto("/page/garden%20plan")
  await page.reload()
  await page.getByRole("treeitem").filter({ hasText: beds }).first().getByText(beds).click()
  await page.keyboard.press("End")
  await page.keyboard.type("!")
  await expect(seqno.editor).toHaveText(`${beds}!`)
  await page.keyboard.press("ControlOrMeta+z")
  await expect(seqno.editor).toHaveText(beds)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("main").getByRole("heading", { name: "Garden Plan" })).toBeVisible()
  await seqno.saved()
  await page.reload()
  await showsPages(page, "14")
})

test("Back returns to the same scroll position in the journals", async ({ page }) => {
  const showcase = await materializeShowcase(new Date())
  await seedOpfs(page, showcase, ["graphs", "demo"])
  await rm(showcase, { recursive: true })
  await openDemo(page)
  const main = page.getByRole("main")
  await expect(main.getByRole("article").nth(2)).toBeVisible()
  await main.evaluate((element) => element.scrollTo({ top: 450, behavior: "instant" }))
  await page.waitForTimeout(200)
  await main.getByRole("link", { name: "Reading List" }).click()
  await expect(page).toHaveURL(/\/page\//)
  await page.goBack()
  await expect(main.getByRole("article").nth(2)).toBeVisible()
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(450)
})

test("embedded, the app hands the page around it only the Escapes it doesn't use", async ({
  page,
  baseURL,
}) => {
  const parent = new URL("/embedding-page", baseURL).href
  await page.route(parent, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>heard = []; addEventListener("message", (event) => heard.push(event.data.type))</script>
        <iframe src="/?embed" style="width: 1200px; height: 800px"></iframe>`,
    }),
  )
  await page.goto(parent)
  const heard = () => page.evaluate(() => Reflect.get(window, "heard"))
  await expect.poll(heard).toEqual(["seqno:ready"])
  const app = page.frameLocator("iframe")
  await app.getByRole("treeitem").getByText("Open Getting started").click()
  await expect(app.getByRole("treeitem").getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(app.getByRole("treeitem").getByRole("textbox")).toHaveCount(0)
  await expect(app.getByRole("treeitem", { selected: true })).toHaveCount(1)
  await page.keyboard.press("Escape")
  await expect(app.getByRole("treeitem", { selected: true })).toHaveCount(0)
  await page.keyboard.press("Control+k")
  await expect(app.getByRole("dialog", { name: "Search" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(app.getByRole("dialog", { name: "Search" })).toBeHidden()
  await page.keyboard.press("Escape")
  await expect.poll(heard).toEqual(["seqno:ready", "seqno:escape"])
})
