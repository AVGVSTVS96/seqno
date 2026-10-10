import { expect, test as base, type Page } from "@playwright/test"
import { journalTitle } from "./journal.ts"
import { opfsFiles } from "./opfs.ts"

const updateFiles = async (page: Page) =>
  Object.keys(await opfsFiles(page, ["graphs", "demo", "updates"]))
    .toSorted()
    .join("\n")

const hintKeys = [
  "contents",
  "graph-menu:demo",
  "graph-menu:developer",
  "page-link",
  "shift-click",
  "references",
  "search",
]

export const openDemo = async (page: Page, path = "/", graph = "Getting started") => {
  await page.goto(path)
  await page.getByRole("button", { name: graph, exact: true }).click()
  await expect(page.getByRole("main")).not.toBeEmpty()
}

export const restOfToday = [
  "Scroll down for the days before today. This graph is a sample to explore: two weeks of notes on a small vegetable garden, with recipes, projects and a Reading list along the way.",
  "Rain all morning, so no watering today. The lettuce seedlings go into bed 2 later this week.",
]

const seqno = (page: Page) => ({
  today: page.getByRole("article", { name: journalTitle(new Date()), exact: true }),
  editor: page.getByRole("treeitem").getByRole("textbox"),
  openDemoGraph: () => openDemo(page),
  saved: () =>
    expect
      .poll(async () => {
        const before = await updateFiles(page)
        await page.waitForTimeout(500)
        return before !== "" && before === (await updateFiles(page))
      })
      .toBe(true),
})

export const test = base.extend<{ seqno: ReturnType<typeof seqno>; hints: boolean }>({
  hints: [false, { option: true }],
  page: async ({ page, hints }, use) => {
    if (!hints) {
      await page.addInitScript((keys) => {
        if (localStorage.getItem("seqno.dismissedHints") === null) {
          localStorage.setItem("seqno.dismissedHints", JSON.stringify(keys))
        }
      }, hintKeys)
    }
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(error.message))
    await use(page)
    expect(errors, "uncaught errors in the page").toEqual([])
  },
  seqno: async ({ page }, use) => use(seqno(page)),
})

export { expect }
