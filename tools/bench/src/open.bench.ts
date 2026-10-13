import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { Effect } from "effect"
import { pickFolder } from "./browser.ts"
import { writeYears } from "./write-years.ts"
import { lastReference, lastWords } from "./years.ts"

const years = Number(process.env["SEQNO_BENCH_YEARS"] ?? 10)
const longPage = Number(process.env["SEQNO_BENCH_LONG_PAGE"] ?? 20_000)
const budgets = { openMs: 5_000, reopenMs: 5_000, reopenIndexedMs: 5_000, reopenSearchMs: 2_000 }

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

const workerMarks = async (page: Page) => {
  const heard: Array<string> = []
  const cdp = await page.context().browser()?.newBrowserCDPSession()
  if (cdp === undefined) return heard
  cdp.on("Target.receivedMessageFromTarget", ({ message }) => {
    const parsed: unknown = JSON.parse(message)
    const text = JSON.stringify(parsed)
    const found = /seqno-t [^"]*/.exec(text)
    if (found !== null) heard.push(found[0])
    else if (text.includes("exceptionThrown")) heard.push(text.slice(0, 400))
  })
  const attached = new Set<string>()
  const attach = async (targetId: string) => {
    if (attached.has(targetId)) return
    attached.add(targetId)
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false })
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id: 1, method: "Runtime.enable" }),
    })
  }
  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    if (targetInfo.type === "shared_worker") {
      heard.push(`seqno-t ${Date.now()} new shared worker`)
      void attach(targetInfo.targetId)
    }
  })
  await cdp.send("Target.setDiscoverTargets", { discover: true })
  const { targetInfos } = await cdp.send("Target.getTargets")
  for (const target of targetInfos.filter((info) => info.type === "shared_worker")) {
    await attach(target.targetId)
  }
  return heard
}

interface ProfileNode {
  readonly id: number
  readonly callFrame: {
    readonly functionName: string
    readonly url: string
    readonly lineNumber: number
  }
  readonly hitCount?: number
  readonly children?: ReadonlyArray<number>
}

const top = (map: Map<string, number>) =>
  [...map]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 45)
    .map(([name, value]) => `${Math.round(value)}ms ${name}`)
    .join("\n")

const summarize = (nodes: ReadonlyArray<ProfileNode>, ms: number) => {
  const hits = nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0)
  const perHit = ms / Math.max(1, hits)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const label = (node: ProfileNode) =>
    `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber}`
  const self = new Map<string, number>()
  const total = new Map<string, number>()
  const totalOf = (node: ProfileNode, above: ReadonlySet<string>): number => {
    const own = (node.hitCount ?? 0) * perHit
    const name = label(node)
    self.set(name, (self.get(name) ?? 0) + own)
    const inner = new Set(above).add(name)
    const sum =
      own +
      (node.children ?? []).reduce((acc, id) => {
        const child = byId.get(id)
        return child === undefined ? acc : acc + totalOf(child, inner)
      }, 0)
    if (!above.has(name)) total.set(name, (total.get(name) ?? 0) + sum)
    return sum
  }
  const root = nodes[0]
  if (root !== undefined) totalOf(root, new Set())
  return `self:\n${top(self)}\ntotal:\n${top(total)}`
}

const longTasks = (page: Page) =>
  page.evaluate(() => {
    const tasks: unknown = Reflect.get(globalThis, "seqnoLongTasks")
    return Array.isArray(tasks) ? tasks.map(String) : []
  })

const searchShowsLastBlock = async (page: Page) => {
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Search", exact: true }).click()
  const searching = performance.now()
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill(`${lastWords} ${lastReference}`)
  await page
    .locator("[role=option][data-kind=Block]")
    .filter({ hasText: lastWords })
    .first()
    .waitFor({ timeout: 300_000 })
  const ms = since(searching)
  await page.keyboard.press("Escape")
  return ms
}

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

    const heard = await workerMarks(page)
    await page.addInitScript(() => {
      const tasks: Array<string> = []
      Reflect.set(globalThis, "seqnoLongTasks", tasks)
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          tasks.push(
            `seqno-t ${Math.round(performance.timeOrigin + entry.startTime)} page longtask ${Math.round(entry.duration)}ms`,
          )
        }
      }).observe({ type: "longtask", buffered: true })
    })
    const tab: Array<string> = []
    const tabMark = (label: string) => tab.push(`seqno-t ${Date.now()} tab ${label}`)
    tabMark("goto")
    const reopening = performance.now()
    await page.goto("/")
    await firstJournal(page)
    tabMark("first journal")
    const reopenMs = since(reopening)
    const indexBytes = (await indexFile(page, "graph")).bytes
    tabMark("index file read")
    const profiler = await page.context().newCDPSession(page)
    await profiler.send("Profiler.enable")
    await profiler.send("Profiler.start")
    const profiling = performance.now()
    await page.keyboard.press("Escape")
    await page.keyboard.press("g")
    await page.keyboard.press("a")
    await page.getByRole("button", { name: "Search pages" }).click()
    tabMark("all pages shown")
    await page.getByRole("searchbox", { name: "Search pages" }).fill(lastReference)
    tabMark("filter typed")
    await page
      .getByRole("main")
      .getByText(lastReference, { exact: true })
      .first()
      .waitFor({ timeout: 300_000 })
    tabMark("quillwort listed")
    const { profile } = await profiler.send("Profiler.stop")
    console.log(summarize(profile.nodes, since(profiling)))
    const reopenIndexedMs = since(reopening)
    const reopenSearchMs = await searchShowsLastBlock(page)
    tabMark("search shown")
    const ended = Date.now()
    const pageTasks = await longTasks(page)

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

    const timeline = [...heard, ...tab, ...pageTasks]
      .map((line) => {
        const [, at = "0", ...rest] = line.split(" ")
        return [Number(at), rest.join(" ")] as const
      })
      .toSorted((a, b) => a[0] - b[0])
    const zero = timeline.find(([, what]) => what === "tab goto")?.[0] ?? 0
    console.log(
      timeline
        .filter(
          ([at, what]) => at <= ended || what.includes("graph fill") || what.includes("timeouts"),
        )
        .map(([at, what]) => `${at - zero} ${what}`)
        .join("\n"),
    )
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
