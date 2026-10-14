import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { Effect } from "effect"
import { firstJournal, jump, keepInBrowser, shown } from "./browser.ts"
import { writeYears } from "./write-years.ts"
import { lastReference, lastWords } from "./years.ts"

const years = Number(process.env["SEQNO_BENCH_YEARS"] ?? 10)
const longPage = Number(process.env["SEQNO_BENCH_LONG_PAGE"] ?? 20_000)
const budgets = {
  openMs: 2_000,
  fillJumpMs: 1_500,
  reopenMs: 2_000,
  reopenIndexedMs: 3_000,
  reopenSearchMs: 2_000,
}

const indexedLastBlock = async (page: Page) => {
  await page.keyboard.press("Escape")
  await page.keyboard.press("g")
  await page.keyboard.press("a")
  await page.getByRole("button", { name: "Search pages" }).click()
  await page.getByRole("searchbox", { name: "Search pages" }).fill(lastReference)
  await shown(page, "main .seqno-table-page", { is: lastReference })
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

const searchShowsLastBlock = async (page: Page) => {
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Search", exact: true }).click()
  const searching = performance.now()
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill(`${lastWords} ${lastReference}`)
  await shown(page, "[role=option][data-kind=Block]", { has: lastWords })
  const ms = since(searching)
  await page.keyboard.press("Escape")
  return ms
}

const openFromList = (page: Page, graph: string) =>
  page.getByRole("button", { name: graph, exact: true }).click()

test(`${years} years of journals kept in the browser open from their snapshot, reopen from the index a reload cut off mid-save, and go on with a fill a reload cut off`, async ({
  page,
}) => {
  const given = process.env["SEQNO_BENCH_FOLDER"]
  const folder = given ?? (await mkdtemp(join(tmpdir(), "seqno-bench-")))
  try {
    if (given === undefined) {
      await Effect.runPromise(Effect.scoped(writeYears(folder, years, longPage, "tree-per-page")))
    }
    await keepInBrowser(page, folder, "graph")
    await page.goto("/graphs")
    const opening = performance.now()
    await openFromList(page, "graph")
    await firstJournal(page)
    const openMs = since(opening)
    const fillJumpMs = Math.max(
      await jump(page, 0.5),
      await jump(page, 0.25),
      await jump(page, 0.75),
    )
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
    const reopenSearchMs = await searchShowsLastBlock(page)

    await keepInBrowser(page, folder, "resumed")
    await page.goto("/graphs")
    const resuming = performance.now()
    await openFromList(page, "resumed")
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
      {
        what: "open: rows on screen after a jump during the fill, slowest of three",
        value: fillJumpMs,
        budget: budgets.fillJumpMs,
      },
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
      {
        what: "reopen: then search shows the long page's last block",
        value: reopenSearchMs,
        budget: budgets.reopenSearchMs,
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
