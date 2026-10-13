import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { Effect } from "effect"
import { pickFolder } from "./browser.ts"
import { writeYears } from "./write-years.ts"
import { lastReference } from "./years.ts"

const years = Number(process.env["SEQNO_BENCH_YEARS"] ?? 10)
const longPage = Number(process.env["SEQNO_BENCH_LONG_PAGE"] ?? 20_000)
const budgets = { openMs: 5_000, reopenMs: 5_000, reopenIndexedMs: 5_000 }

const firstJournal = (page: Page) =>
  page.locator(".seqno-journal [role=treeitem]").first().waitFor()

const indexedLastBlock = async (page: Page) => {
  await page.keyboard.press("Escape")
  await page.keyboard.press("g")
  await page.keyboard.press("a")
  await page.getByRole("button", { name: "Search pages" }).click()
  await page.getByRole("searchbox", { name: "Search pages" }).fill(lastReference)
  await page
    .getByRole("main")
    .getByText(lastReference, { exact: true })
    .first()
    .waitFor({ timeout: 300_000 })
}

const indexFile = (page: Page, graph: string) =>
  page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory()
    const indexes = await root.getDirectoryHandle("indexes").catch(() => undefined)
    const names: Array<string> = []
    if (indexes !== undefined) for await (const entry of indexes.keys()) names.push(entry)
    const file = await indexes?.getFileHandle(`${name}.sqlite`).catch(() => undefined)
    return {
      writing: names.includes(`${name}.sqlite.crswap`),
      bytes: file === undefined ? 0 : (await file.getFile()).size,
    }
  }, graph)

const saveStarted = async (page: Page, graph: string) => {
  for (;;) {
    const { writing, bytes } = await indexFile(page, graph)
    if (writing) return "writing"
    if (bytes > 0) return "written"
  }
}

const savedAtLeast = async (page: Page, graph: string, bytes: number) => {
  for (;;) {
    if ((await indexFile(page, graph)).bytes >= bytes) return
  }
}

const since = (started: number) => performance.now() - started

test(`${years} years of journals open from their snapshot, reopen from the index a reload cut off mid-save, and go on with a fill a reload cut off`, async ({
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
    await indexedLastBlock(page)
    const fillMs = since(opening)
    const reloadedWhile = await saveStarted(page, "graph")
    const bytesAtReload = (await indexFile(page, "graph")).bytes

    const reopening = performance.now()
    await page.goto("/")
    await firstJournal(page)
    const reopenMs = since(reopening)
    const indexBytes = (await indexFile(page, "graph")).bytes
    await indexedLastBlock(page)
    const reopenIndexedMs = since(reopening)

    await pickFolder(page, folder, "resumed")
    await page.goto("/graphs")
    const resuming = performance.now()
    await page.getByRole("button", { name: "Open a folder" }).first().click()
    await firstJournal(page)
    await savedAtLeast(page, "resumed", indexBytes / 2)
    const cutAtMs = since(resuming)
    const resumed = performance.now()
    await page.goto("/")
    await firstJournal(page)
    await indexedLastBlock(page)
    const restMs = since(resumed)

    const rows = [
      { what: "open: first journal on screen", value: openMs, budget: budgets.openMs },
      { what: "open: the index has the long page's last block", value: fillMs, budget: null },
      {
        what: `reopen after a reload while the save was ${reloadedWhile}: first journal`,
        value: reopenMs,
        budget: budgets.reopenMs,
      },
      {
        what: "reopen: index file MB on disk at the reload",
        value: bytesAtReload / 1e6,
        budget: null,
      },
      { what: "reopen: index file MB the closed tab saved", value: indexBytes / 1e6, budget: null },
      {
        what: "reopen: the index has the long page's last block",
        value: reopenIndexedMs,
        budget: budgets.reopenIndexedMs,
      },
      { what: "second fill: reloaded once half the index was saved", value: cutAtMs, budget: null },
      {
        what: "second fill: the rest, after the reload (a restart takes a whole fill)",
        value: restMs,
        budget: fillMs,
      },
    ]
    console.table(rows.map((row) => ({ ...row, value: Math.round(row.value * 10) / 10 })))
    expect(
      rows.filter((row) => row.budget !== null && row.value > row.budget).map((row) => row.what),
    ).toEqual([])
    expect([indexBytes > 0, cutAtMs < fillMs]).toEqual([true, true])
  } finally {
    if (given === undefined) await rm(folder, { recursive: true })
  }
})
