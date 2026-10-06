import { expect, test as base, type Page } from "@playwright/test"
import { journalTitle } from "./journal.ts"
import { opfsFiles } from "./opfs.ts"

const updateFiles = async (page: Page) =>
  Object.keys(await opfsFiles(page, ["graphs", "demo", "updates"]))
    .toSorted()
    .join("\n")

const seqno = (page: Page) => ({
  today: page.getByRole("article", { name: journalTitle(new Date()), exact: true }),
  editor: page.getByRole("treeitem").getByRole("textbox"),
  openDemoGraph: async () => {
    await page.goto("/")
  },
  saved: () =>
    expect
      .poll(async () => {
        const before = await updateFiles(page)
        await page.waitForTimeout(500)
        return before !== "" && before === (await updateFiles(page))
      })
      .toBe(true),
})

export const test = base.extend<{ seqno: ReturnType<typeof seqno> }>({
  page: async ({ page }, use) => {
    const errors: Array<string> = []
    page.on("pageerror", (error) => errors.push(error.message))
    await use(page)
    expect(errors, "uncaught errors in the page").toEqual([])
  },
  seqno: async ({ page }, use) => use(seqno(page)),
})

export { expect }
