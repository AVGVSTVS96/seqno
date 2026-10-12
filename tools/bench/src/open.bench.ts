import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { Effect } from "effect"
import { pickFolder } from "./browser.ts"
import { writeYears } from "./write-years.ts"
import { lastBlock } from "./years.ts"

const years = Number(process.env["SEQNO_BENCH_YEARS"] ?? 10)
const longPage = Number(process.env["SEQNO_BENCH_LONG_PAGE"] ?? 20_000)
const budgets = { openMs: 5_000, reopenMs: 5_000, reopenSearchMs: 5_000 }

const firstJournal = (page: Page) =>
  page.locator(".seqno-journal [role=treeitem]").first().waitFor()

const searchFindsLastBlock = async (page: Page) => {
  await page.getByRole("button", { name: "Search", exact: true }).click()
  const box = page.getByRole("searchbox", { name: "Search" })
  const option = page.getByRole("option").filter({ hasText: lastBlock }).first()
  for (;;) {
    await box.fill(lastBlock)
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

const indexSave = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const indexes = await root.getDirectoryHandle("indexes").catch(() => undefined)
    if (indexes === undefined) return "none"
    for await (const handle of indexes.values()) {
      if (handle.name.endsWith(".sqlite.crswap")) return "writing"
      if (handle.kind === "file" && (await handle.getFile()).size > 0) return "written"
    }
    return "none"
  })

const saveStarted = async (page: Page) => {
  for (;;) {
    const state = await indexSave(page)
    if (state !== "none") return state
  }
}

const since = (started: number) => performance.now() - started

test(`${years} years of journals open from their snapshot, and a reload while the index saves reopens from that save`, async ({
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
    const reloadedWhile = await saveStarted(page)
    const savingMs = since(opening)

    const reopening = performance.now()
    await page.reload()
    await firstJournal(page)
    const reopenMs = since(reopening)
    const indexMb = (await savedIndexBytes(page)) / 1e6
    await searchFindsLastBlock(page)
    const reopenSearchMs = since(reopening)

    const rows = [
      { what: "open: first journal on screen", value: openMs, budget: budgets.openMs },
      {
        what: `open: filled, index save ${reloadedWhile} at reload`,
        value: savingMs,
        budget: null,
      },
      { what: "reopen: first journal on screen", value: reopenMs, budget: budgets.reopenMs },
      { what: "reopen: index file MB the closed tab saved", value: indexMb, budget: null },
      {
        what: "reopen: search finds the last block",
        value: reopenSearchMs,
        budget: budgets.reopenSearchMs,
      },
    ]
    console.table(rows.map((row) => ({ ...row, value: Math.round(row.value * 10) / 10 })))
    expect(
      rows.filter((row) => row.budget !== null && row.value > row.budget).map((row) => row.what),
    ).toEqual([])
    expect(indexMb).toBeGreaterThan(0)
  } finally {
    if (given === undefined) await rm(folder, { recursive: true })
  }
})
