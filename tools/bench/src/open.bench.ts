import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { Effect } from "effect"
import { pickFolder } from "./browser.ts"
import { writeYears } from "./write-years.ts"

const years = Number(process.env["SEQNO_BENCH_YEARS"] ?? 10)
const longPage = Number(process.env["SEQNO_BENCH_LONG_PAGE"] ?? 20_000)
const budgets = { openMs: 5_000, reopenMs: 5_000, reopenSearchMs: 6_000 }
const lastPage = "Long page"

const firstJournal = (page: Page) =>
  page.locator(".seqno-journal [role=treeitem]").first().waitFor()

const searchFinds = async (page: Page, title: string) => {
  await page.getByRole("button", { name: "Search", exact: true }).click()
  const box = page.getByRole("searchbox", { name: "Search" })
  const option = page.getByRole("option", { name: title, exact: true }).first()
  for (;;) {
    await box.fill(title)
    const found = await option.waitFor({ timeout: 250 }).then(
      () => true,
      () => false,
    )
    if (found) break
    await box.fill("")
  }
  await page.keyboard.press("Escape")
}

const savedIndexBytes = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const indexes = await root.getDirectoryHandle("indexes").catch(() => undefined)
    if (indexes === undefined) return 0
    for await (const handle of indexes.values()) {
      if (handle.kind === "file" && handle.name.endsWith(".sqlite")) {
        return (await handle.getFile()).size
      }
    }
    return 0
  })

const since = (started: number) => performance.now() - started

test(`${years} years of journals open from their snapshot, and reopen from the saved index`, async ({
  page,
}) => {
  const given = process.env["SEQNO_BENCH_FOLDER"]
  const folder = given ?? (await mkdtemp(join(tmpdir(), "seqno-bench-")))
  try {
    if (given === undefined) {
      await Effect.runPromise(Effect.scoped(writeYears(folder, years, longPage)))
    }
    await pickFolder(page, folder)
    await page.goto("/")
    const opening = performance.now()
    await page.getByRole("button", { name: "Open a folder" }).first().click()
    await firstJournal(page)
    const openMs = since(opening)
    await searchFinds(page, lastPage)
    const filledMs = since(opening)
    await expect.poll(() => savedIndexBytes(page), { timeout: 120_000 }).toBeGreaterThan(0)
    const savedMs = since(opening)
    const indexMb = (await savedIndexBytes(page)) / 1e6

    const reopening = performance.now()
    await page.reload()
    await firstJournal(page)
    const reopenMs = since(reopening)
    await searchFinds(page, lastPage)
    const reopenSearchMs = since(reopening)

    const rows = [
      { what: "open: first journal on screen", value: openMs, budget: budgets.openMs },
      { what: "open: search finds the last page filled", value: filledMs, budget: null },
      { what: "open: index saved", value: savedMs, budget: null },
      { what: "index file MB", value: indexMb, budget: null },
      { what: "reopen: first journal on screen", value: reopenMs, budget: budgets.reopenMs },
      {
        what: "reopen: search finds the last page",
        value: reopenSearchMs,
        budget: budgets.reopenSearchMs,
      },
    ]
    console.table(rows.map((row) => ({ ...row, value: Math.round(row.value * 10) / 10 })))
    expect(
      rows.filter((row) => row.budget !== null && row.value > row.budget).map((row) => row.what),
    ).toEqual([])
  } finally {
    if (given === undefined) await rm(folder, { recursive: true })
  }
})
