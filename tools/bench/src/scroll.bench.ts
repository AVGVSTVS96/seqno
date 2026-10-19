import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type Page } from "@playwright/test"
import {
  firstJournal,
  jump,
  keepInBrowser,
  memory,
  pickFolder,
  scrollFrames,
  test,
} from "./browser.ts"
import { size, yearsOf } from "./size.ts"
import { writeYears } from "./write-years.ts"
import type { Layout } from "./years.ts"

const longPage = Number(process.env["SEQNO_BENCH_LONG_PAGE"] ?? 20_000)
const budgets = { openMs: 3_000, frameP95Ms: 33.4, domNodes: 15_000, jumpMs: 1_500 }
const frames = 600
const pxPerFrame = 60
const layout: Layout =
  process.env["SEQNO_BENCH_LAYOUT"] === "tree-per-page" ? "tree-per-page" : "one-tree"

const ways: Record<
  Layout,
  {
    readonly what: string
    readonly put: typeof keepInBrowser
    readonly from: string
    readonly open: (page: Page) => Promise<void>
  }
> = {
  "one-tree": {
    what: "in a picked folder",
    put: pickFolder,
    from: "/",
    open: (page) => page.getByRole("button", { name: "Open a folder" }).first().click(),
  },
  "tree-per-page": {
    what: "kept in the browser",
    put: keepInBrowser,
    from: "/graphs",
    open: (page) => page.getByRole("button", { name: "graph", exact: true }).click(),
  },
}
const way = ways[layout]

test(`${yearsOf(size)} of journals ${way.what} open, and the journals and a ${longPage}-block page scroll smoothly`, async ({
  page,
}) => {
  const folder = await mkdtemp(join(tmpdir(), "seqno-bench-"))
  try {
    const shape = await writeYears(folder, size, longPage, layout)
    await way.put(page, folder, "graph")
    await page.goto(way.from)
    const started = performance.now()
    await way.open(page)
    await firstJournal(page)
    const openMs = performance.now() - started
    const opened = await memory(page)
    const journals = await scrollFrames(page, pxPerFrame, frames)
    const deeper = await scrollFrames(page, pxPerFrame, frames)
    const scrolled = await memory(page)
    const journalsJump = await jump(page, 0.5)
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await page.getByRole("searchbox", { name: "Search" }).fill("Long page")
    await page.getByRole("option", { name: "Long page", exact: true }).first().click()
    await page.getByRole("article", { name: "Long page" }).getByRole("treeitem").first().waitFor()
    const long = await scrollFrames(page, pxPerFrame, frames)
    const end = await memory(page)
    const longJump = await jump(page, 0.5)
    const rows = [
      { what: "open: first journal on screen", value: openMs, budget: budgets.openMs },
      { what: "journals: frame p95 (ms)", value: journals.p95, budget: budgets.frameP95Ms },
      { what: "journals deeper: frame p95 (ms)", value: deeper.p95, budget: budgets.frameP95Ms },
      { what: "long page: frame p95 (ms)", value: long.p95, budget: budgets.frameP95Ms },
      {
        what: "journals: DOM nodes after scrolling",
        value: scrolled.domNodes,
        budget: budgets.domNodes,
      },
      {
        what: "journals: rows on screen after a jump (ms)",
        value: journalsJump,
        budget: budgets.jumpMs,
      },
      {
        what: "long page: rows on screen after a jump (ms)",
        value: longJump,
        budget: budgets.jumpMs,
      },
      {
        what: "graph: days, pages, blocks",
        value: `${shape.days}, ${shape.pages}, ${shape.blocks}`,
        budget: null,
      },
      {
        what: "frames over 50 ms: journals, deeper, long page",
        value: `${journals.over50}, ${deeper.over50}, ${long.over50}`,
        budget: null,
      },
      {
        what: "page heap MB: opened, scrolled, long page",
        value: `${opened.pageHeapMb}, ${scrolled.pageHeapMb}, ${end.pageHeapMb}`,
        budget: null,
      },
      {
        what: "Chrome MB: opened, scrolled, long page",
        value: `${opened.chromeMb}, ${scrolled.chromeMb}, ${end.chromeMb}`,
        budget: null,
      },
    ]
    console.table(
      rows.map((row) => ({
        ...row,
        value: typeof row.value === "number" ? Math.round(row.value * 10) / 10 : row.value,
      })),
    )
    expect(
      rows
        .filter(
          (row) => typeof row.value === "number" && row.budget !== null && row.value > row.budget,
        )
        .map((row) => row.what),
    ).toEqual([])
  } finally {
    await rm(folder, { recursive: true })
  }
})
