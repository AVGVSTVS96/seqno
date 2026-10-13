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

const searchFindsLastBlock = async (page: Page, graph = "graph") => {
  await page.getByRole("button", { name: "Search", exact: true }).click()
  const box = page.getByRole("searchbox", { name: "Search" })
  const option = page
    .locator("[role=option][data-kind=Block]")
    .filter({ hasText: lastBlock })
    .first()
  let smallest = Number.POSITIVE_INFINITY
  for (;;) {
    await box.fill(lastBlock)
    const found = await option.waitFor({ timeout: 250 }).then(
      () => true,
      () => false,
    )
    if (found) break
    await box.fill("")
    smallest = Math.min(smallest, (await indexFile(page, graph)).bytes)
  }
  await page.keyboard.press("Escape")
  return smallest
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

const sharedWorkers = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page)
  const { targetInfos } = await cdp.send("Target.getTargets")
  await cdp.detach()
  return targetInfos
    .filter((target) => target.type === "shared_worker")
    .map((target) => target.targetId)
}

const workerConsole = async (page: Page) => {
  const heard: Array<string> = []
  const cdp = await page.context().browser()?.newBrowserCDPSession()
  if (cdp === undefined) return heard
  cdp.on("Target.receivedMessageFromTarget", ({ message }) => {
    const parsed: unknown = JSON.parse(message)
    const text = JSON.stringify(parsed)
    if (text.includes("consoleAPICalled") || text.includes("exceptionThrown"))
      heard.push(text.slice(0, 800))
  })
  const { targetInfos } = await cdp.send("Target.getTargets")
  for (const target of targetInfos.filter((info) => info.type === "shared_worker")) {
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    })
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id: 1, method: "Runtime.enable" }),
    })
  }
  return heard
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
    await searchFindsLastBlock(page)
    const fillMs = since(opening)
    const reloadedWhile = await saveStarted(page, "graph")
    const bytesAtReload = (await indexFile(page, "graph")).bytes
    const workersBefore = await sharedWorkers(page)
    const heard = await workerConsole(page)

    const reopening = performance.now()
    await page.reload()
    await firstJournal(page)
    const reopenMs = since(reopening)
    const workersAfter = await sharedWorkers(page)
    console.log(
      JSON.stringify({
        chrome: page.context().browser()?.version(),
        workersBefore,
        workersAfter,
      }),
    )
    const indexBytes = (await indexFile(page, "graph")).bytes
    const smallestWhileCatchingUp = await searchFindsLastBlock(page)
    console.log(JSON.stringify(heard.slice(0, 40)))
    const reopenSearchMs = since(reopening)

    await pickFolder(page, folder, "resumed")
    await page.goto("/graphs")
    const resuming = performance.now()
    await page.getByRole("button", { name: "Open a folder" }).first().click()
    await firstJournal(page)
    await savedAtLeast(page, "resumed", indexBytes / 2)
    const cutAtMs = since(resuming)
    const resumed = performance.now()
    await page.reload()
    await firstJournal(page)
    await searchFindsLastBlock(page)
    const restMs = since(resumed)

    const rows = [
      { what: "open: first journal on screen", value: openMs, budget: budgets.openMs },
      { what: "open: search finds the last block filled", value: fillMs, budget: null },
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
        what: "reopen: smallest index file MB while catching up",
        value: smallestWhileCatchingUp / 1e6,
        budget: null,
      },
      {
        what: "reopen: search finds the last block",
        value: reopenSearchMs,
        budget: budgets.reopenSearchMs,
      },
      {
        what: "second fill: reloaded once half the index was saved",
        value: cutAtMs,
        budget: null,
      },
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
