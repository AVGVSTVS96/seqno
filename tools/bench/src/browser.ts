import { readdir, readFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createServer } from "node:http"
import { join, relative } from "node:path"
import type { Page } from "@playwright/test"

const serveFolder = async (from: string, files: ReadonlyArray<string>) => {
  const server = createServer((request, response) => {
    const file = files[Number(request.url?.slice(1))]
    response.setHeader("Access-Control-Allow-Origin", "*")
    if (file === undefined) return void response.writeHead(404).end()
    createReadStream(join(from, file)).pipe(response)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  return {
    server,
    base:
      typeof address === "object" && address !== null ? `http://127.0.0.1:${address.port}/` : "",
  }
}

const copyIntoOpfs = async (page: Page, from: string, into: ReadonlyArray<string>) => {
  const files = (await readdir(from, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(from, join(entry.parentPath, entry.name)))
  const { server, base } = await serveFolder(from, files)
  try {
    await page.goto("/")
    await page.evaluate(
      async (seed) => {
        const root = navigator.storage.getDirectory()
        const directory = (path: ReadonlyArray<string>) =>
          path.reduce(
            async (handle, part) => (await handle).getDirectoryHandle(part, { create: true }),
            root,
          )
        for (const [at, path] of seed.files.entries()) {
          const parts = [...seed.into, ...path.split("/")]
          const name = parts.pop() ?? ""
          const file = await (await directory(parts)).getFileHandle(name, { create: true })
          const body = (await fetch(`${seed.base}${at}`)).body
          if (body !== null) await body.pipeTo(await file.createWritable())
        }
      },
      { base, files, into },
    )
  } finally {
    server.close()
  }
}

const dismissHints = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "seqno.dismissedHints",
      JSON.stringify(["contents", "page-link", "shift-click", "references", "search"]),
    )
  })

export const pickFolder = async (page: Page, from: string, graph = "graph") => {
  const picked = ["seqno-bench-picked", graph]
  await copyIntoOpfs(page, from, picked)
  await dismissHints(page)
  await page.addInitScript((path) => {
    window.showDirectoryPicker = () =>
      path.reduce(
        async (dir, part) => (await dir).getDirectoryHandle(part),
        navigator.storage.getDirectory(),
      )
  }, picked)
}

export const keepInBrowser = async (page: Page, from: string, graph: string) => {
  await copyIntoOpfs(page, from, ["graphs", graph])
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("seqno", 1)
        opening.addEventListener("upgradeneeded", () =>
          opening.result.createObjectStore("graphs", { keyPath: "name" }),
        )
        opening.addEventListener("error", () => reject(opening.error))
        opening.addEventListener("success", () => {
          const saving = opening.result
            .transaction("graphs", "readwrite")
            .objectStore("graphs")
            .put({ _tag: "OpfsGraph", name })
          saving.addEventListener("success", () => resolve())
          saving.addEventListener("error", () => reject(saving.error))
        })
      }),
    graph,
  )
  await dismissHints(page)
}

export interface Frames {
  readonly frames: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  readonly over50: number
  readonly travelled: number
}

export const scrollFrames = (page: Page, pxPerFrame: number, frames: number): Promise<Frames> =>
  page.evaluate(
    (run) =>
      new Promise<Frames>((resolve) => {
        const scroller = document.querySelector(".main-content-container")
        if (!(scroller instanceof HTMLElement)) throw new Error("no scroller")
        const start = scroller.scrollTop
        const gaps: Array<number> = []
        let last = performance.now()
        const step = (now: number) => {
          gaps.push(now - last)
          last = now
          if (gaps.length > run.frames) {
            const sorted = gaps.slice(1).toSorted((a, b) => a - b)
            const at = (q: number) =>
              Math.round(
                (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0) * 10,
              ) / 10
            resolve({
              frames: sorted.length,
              p50: at(0.5),
              p95: at(0.95),
              p99: at(0.99),
              max: at(1),
              over50: sorted.filter((gap) => gap > 50).length,
              travelled: Math.round(scroller.scrollTop - start),
            })
            return
          }
          scroller.scrollTop += run.pxPerFrame
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    { pxPerFrame, frames },
  )

const procs = async () => {
  const all = await readdir("/proc")
  const rows = await Promise.all(
    all
      .filter((name) => /^\d+$/.test(name))
      .map(async (pid) => {
        const [stat, cmdline] = await Promise.all([
          readFile(`/proc/${pid}/stat`, "utf8").catch(() => ""),
          readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => ""),
        ])
        const ppid = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1] ?? ""
        return { pid, ppid, cmdline }
      }),
  )
  return rows
}

const pss = async (pid: string) => {
  const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8").catch(() => "")
  return Number(/^Pss:\s+(\d+) kB/m.exec(rollup)?.[1] ?? 0) * 1024
}

export const browserFlag = "--seqno-bench"

export const memory = async (page: Page) => {
  const session = await page.context().newCDPSession(page)
  await session.send("Performance.enable")
  const { metrics } = await session.send("Performance.getMetrics")
  await session.detach()
  const metric = (name: string) => metrics.find((one) => one.name === name)?.value ?? 0
  const all = await procs()
  const tree = new Set(
    all.filter((proc) => proc.cmdline.includes(browserFlag)).map((proc) => proc.pid),
  )
  for (let grew = true; grew;) {
    grew = false
    for (const proc of all) {
      if (!tree.has(proc.pid) && tree.has(proc.ppid)) {
        tree.add(proc.pid)
        grew = true
      }
    }
  }
  const total = (await Promise.all([...tree].map(pss))).reduce((a, b) => a + b, 0)
  return {
    pageHeapMb: Math.round(metric("JSHeapUsedSize") / 1e6),
    domNodes: metric("Nodes"),
    chromeMb: Math.round(total / 1e6),
  }
}

export const shown = (
  page: Page,
  selector: string,
  text?: { readonly is: string } | { readonly has: string },
) =>
  page.waitForFunction(
    (wanted) =>
      [...document.querySelectorAll(wanted.selector)].some((element) => {
        const content = element.textContent ?? ""
        const matches =
          wanted.text === undefined ||
          ("is" in wanted.text ? content === wanted.text.is : content.includes(wanted.text.has))
        return matches && element.checkVisibility()
      }),
    { selector, text },
    { polling: "raf", timeout: 300_000 },
  )

export const firstJournal = (page: Page) => shown(page, ".seqno-journal [role=treeitem]")

export const jump = (page: Page, fraction: number) =>
  page.evaluate(async (to) => {
    const scroller = document.querySelector(".main-content-container")
    if (!(scroller instanceof HTMLElement)) throw new Error("no scroller")
    const started = performance.now()
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * to
    const box = scroller.getBoundingClientRect()
    const rowOnScreen = () =>
      [...document.querySelectorAll("[role=treeitem]")].some((row) => {
        const at = row.getBoundingClientRect()
        return at.bottom > box.top && at.top < box.bottom
      })
    for (let frame = 0; frame < 600; frame++) {
      await new Promise(requestAnimationFrame)
      if (rowOnScreen()) return Math.round(performance.now() - started)
    }
    return Number.POSITIVE_INFINITY
  }, fraction)
