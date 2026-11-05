import { expect, test as base } from "@playwright/test"
import type { Page } from "@playwright/test"
import { journalTitle } from "./journal.ts"

const editLogFiles = async (page: Page) =>
  await page.evaluate(async () => {
    const names: string[] = []

    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const entry of dir.values()) {
        if (entry.kind === "file") {
          names.push(`${prefix}${entry.name}`)
        } else {
          await walk(entry, `${prefix}${entry.name}/`)
        }
      }
    }

    const root = await navigator.storage.getDirectory()
    const graph = await (await root.getDirectoryHandle("graphs")).getDirectoryHandle("demo")
    const log = await graph.getDirectoryHandle("edit-log")

    for await (const entry of log.values()) {
      if (entry.kind === "directory" && (entry.name === "updates" || entry.name === "snapshots")) {
        await walk(entry, `${entry.name}/`)
      }
    }

    return names.toSorted().join("\n")
  })

export const saved = async (page: Page, timeout = 5000) => {
  await expect
    .poll(
      async () => {
        const before = await editLogFiles(page)
        await page.waitForTimeout(500)

        return before !== "" && before === (await editLogFiles(page))
      },
      { timeout },
    )
    .toBe(true)
}

export const todayOn = (page: Page) =>
  page.getByRole("article", { name: journalTitle(new Date()), exact: true })

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
  today: todayOn(page),
  editor: page.getByRole("treeitem").getByRole("textbox"),
  openDemoGraph: async () => {
    await openDemo(page)
  },
  saved: async () => {
    await saved(page)
  },
})

export const test = base.extend<{
  seqno: ReturnType<typeof seqno>
  hints: boolean
  onboarded: boolean
}>({
  hints: [false, { option: true }],
  onboarded: [true, { option: true }],
  page: async ({ page, hints, onboarded }, use) => {
    if (onboarded) {
      await page.addInitScript(() => {
        if (window.top !== window) {
          return
        }

        for (const key of ["seqno.onboardingWhiteboard", "seqno.whiteboardTour"]) {
          if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, "true")
          }
        }
      })
    }

    if (!hints) {
      await page.addInitScript((keys) => {
        if (window.top === window && localStorage.getItem("seqno.dismissedHints") === null) {
          localStorage.setItem("seqno.dismissedHints", JSON.stringify(keys))
        }
      }, hintKeys)
    }

    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await use(page)
    expect(errors, "uncaught errors in the page").toEqual([])
  },
  seqno: async ({ page }, use) => {
    await use(seqno(page))
  },
})

export { expect }
