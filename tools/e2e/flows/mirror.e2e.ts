import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"
import type { Page } from "@playwright/test"
import { Context, Crypto, Effect, Layer, Option } from "effect"
import { DeviceId } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { Vault, layer as vaultLayer } from "@seqno/vault"
import { layerNode } from "@seqno/vault/node"
import { appAvailable } from "../src/env.ts"
import {
  fixtureGraph,
  loadGraphFolder,
  opfsFile,
  opfsFiles,
  opfsText,
  pickedFolder,
  removeOpfsEntry,
  seedOpfs,
  writeOpfsFile,
} from "../src/opfs.ts"
import { expect, test, todayOn } from "../src/test.ts"
import { board } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

const og = fixtureGraph("graphs/og-syntax-mix")
const ogFolder = pickedFolder(og)

const diskFiles = async (root: string) => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })

  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))

  return Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), "utf-8")])),
  )
}

const openFolder = async (page: Page, from: string) => {
  await loadGraphFolder(page, from)
  await page.goto("/")
  await page.getByRole("button", { name: "Open a folder" }).click()
  await expect(todayOn(page)).toBeVisible()
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved")
}

const openPage = async (page: Page, name: string) => {
  await page.keyboard.press("Control+k")
  await page.getByRole("searchbox", { name: "Search" }).fill(name)
  await expect(page.locator("[role=option][data-kind]").first()).toHaveText(name)
  await page.keyboard.press("Enter")

  return page.getByRole("article", { name, exact: true })
}

const textOf = async (page: Page, path: string) =>
  (await opfsFile(page, ogFolder, path))?.text ?? null

const journal = "journals/2025_03_09.md"

const seenName = async (page: Page) =>
  Object.keys(await opfsFiles(page, ogFolder))
    .map((path) => path.split("/"))
    .find(([dir, name]) => dir === "seen" && name !== "web-phone.json")?.[1] ?? ""

const ogJournal = [
  "- journal links to [[project/Alpha]] and [[Alpha Project]] (edited)",
  "- journal uses a namespaced tag #project/Alpha",
  "- time-tracked task",
  "  :LOGBOOK:",
  "  CLOCK: [2025-03-09 Sun 10:00:00]--[2025-03-09 Sun 10:30:00] =>  00:30:00",
  "  :END:",
].join("\n")

const typeInJournal = async (page: Page, text: string) => {
  const day = await openPage(page, "Mar 9th, 2025")
  await day.getByRole("treeitem").first().getByText("journal links to").click()
  await page.keyboard.press("End")
  await page.keyboard.type(text)
}

for (const name of ["og-syntax-mix", "org-and-front-matter", "whiteboards", "showcase"]) {
  test(`turning the mirror on rewrites none of ${name}'s files`, async ({ page }) => {
    const from = fixtureGraph(`graphs/${name}`)
    const before = await diskFiles(from)
    await openFolder(page, from)
    await page.waitForTimeout(3500)
    const after = await opfsText(page, pickedFolder(from))
    const changed = Object.keys(before).filter((path) => after[path] !== before[path])

    const added = Object.keys(after).filter(
      (path) =>
        !(path in before) &&
        /^(journals|pages|whiteboards)\//.test(path) &&
        !/^journals\/\d{4}_\d{2}_\d{2}\.md$/.test(path),
    )

    expect({ changed, added }).toEqual({ changed: [], added: [] })
  })
}

test("an edit reaches its journal file within 2 seconds, and no other file changes", async ({
  page,
}) => {
  const before = await diskFiles(og)
  await openFolder(page, og)
  await typeInJournal(page, " (edited)")
  await expect.poll(async () => await textOf(page, journal), { timeout: 2000 }).toBe(ogJournal)
  await page.keyboard.press("Escape")
  const after = await opfsText(page, ogFolder)
  expect(
    Object.keys(before).filter((path) => path !== journal && after[path] !== before[path]),
  ).toEqual([])
})

test("a ref typed to a block on another page writes that block's id:: into its file", async ({
  page,
}) => {
  await openFolder(page, og)
  await typeInJournal(page, " ((recorded a")
  await expect(page.getByRole("option", { selected: true })).toContainText("I recorded a")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await expect
    .poll(async () => await textOf(page, "pages/tasks.md"))
    .toMatch(/\n- I recorded a \[\[voice note\]\]\.\n {2}id:: [0-9a-f-]{36}\n\t- TODO\n/)
  const id = /id:: ([0-9a-f-]{36})/.exec((await textOf(page, "pages/tasks.md")) ?? "")?.[1]
  await expect.poll(async () => await textOf(page, journal)).toContain(`((${id}))`)
})

test("a rename moves the old file to logseq/.recycle and writes the new one", async ({ page }) => {
  const before = await diskFiles(og)
  await openFolder(page, og)
  await openPage(page, "queries")
  await page.getByRole("heading", { level: 1, name: "queries" }).click()
  const title = page.getByRole("textbox", { name: "Page title" })
  await title.press("End")
  await title.pressSequentially(" saved")
  await title.press("Enter")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("queries saved")
  await expect
    .poll(async () => await textOf(page, "pages/queries saved.md"))
    .toBe((before["pages/queries.md"] ?? "").trimEnd())
  await expect.poll(async () => await textOf(page, "pages/queries.md")).toBeNull()
  expect(await textOf(page, "logseq/.recycle/pages_queries.md")).toBe(before["pages/queries.md"])
})

const uuidsIn = (text: string) =>
  [...text.matchAll(/:block\/uuid #uuid "([0-9a-f-]{36})"/g)].map((match) => match[1]).toSorted()

test("moving a whiteboard shape rewrites the board's file, which reads back with the same ids", async ({
  page,
}) => {
  const from = fixtureGraph("graphs/whiteboards")
  const folder = pickedFolder(from)
  const path = "whiteboards/Colloquium 2.edn"
  const before = (await readFile(join(from, path), "utf-8")).toString()
  await openFolder(page, from)
  await openPage(page, "colloquium 2")
  await expect(board(page)).toBeVisible()
  const count = await board(page).locator(".wb-shape").count()
  const shape = board(page).locator(".wb-shape").first()
  const box = await shape.boundingBox()

  if (box === null) {
    throw new Error("the board has no shape on screen")
  }

  await page.keyboard.press("1")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await opfsFile(page, folder, path))?.text).not.toBe(before)
  const after = (await opfsFile(page, folder, path))?.text ?? ""
  expect(uuidsIn(after)).toEqual(uuidsIn(before))
  await page.reload()
  await openPage(page, "colloquium 2")
  await expect(board(page).locator(".wb-shape")).toHaveCount(count)
})

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the graph"),
  }),
)

const phoneEdits = (root: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const phone = DeviceId.make("phone")

      const graph = Context.get(
        yield* Layer.build(
          Graph.layer({ peer: PeerId.make("4242"), snapshot: Option.none(), updates: [] }).pipe(
            Layer.provide(WebCrypto),
          ),
        ),
        Graph,
      )

      const vault = Context.get(
        yield* Layer.build(
          vaultLayer({
            device: phone,
            members: [phone],
            compactAfterFiles: 1e6,
            compactEvery: 0,
          }).pipe(Layer.provide(layerNode(root))),
        ),
        Vault,
      )

      yield* Effect.orDie(vault.sync(vaultReplica(graph)))
      const tasks = (yield* graph.pages).find((one) => one.title === "tasks")

      if (tasks === undefined) {
        return yield* Effect.die("the phone has no tasks page")
      }

      const first = (yield* Effect.orDie(graph.page(tasks.id))).blocks[0]

      if (first === undefined) {
        return yield* Effect.die("tasks has no block")
      }

      yield* Effect.orDie(
        graph.dispatch({ _tag: "EditText", blockId: first.id, from: 4, to: 4, insert: " (phone)" }),
      )
      yield* graph.flush((update) => Effect.orDie(vault.writeUpdate(update.bytes)))
    }),
  )

test("another device's edit reaches the file once this device merges it", async ({
  page,
}, testInfo) => {
  await openFolder(page, og)
  const copy = testInfo.outputPath("phone")

  for (const [path, bytes] of Object.entries(await opfsFiles(page, ogFolder))) {
    if (!/^(updates|snapshots|seen)\//.test(path)) {
      continue
    }

    await mkdir(dirname(join(copy, path)), { recursive: true })
    await writeFile(join(copy, path), bytes)
  }

  await Effect.runPromise(phoneEdits(copy))
  await seedOpfs(await page.context().newPage(), join(copy, "updates", "phone"), [
    ...ogFolder,
    "updates",
    "phone",
  ])
  await expect
    .poll(async () => await textOf(page, "pages/tasks.md"), { timeout: 20_000 })
    .toMatch(/^- TODO \(phone\)\n- DONE\n/)
})

const logseqDesktopWrites = async (
  page: Page,
  root: readonly string[],
  path: string,
  text: string,
) => {
  await page.evaluate(
    async ({ dirs, file, content }) => {
      const source = `onmessage = async ({ data }) => {
        let dir = await navigator.storage.getDirectory()
        for (const part of data.dirs) dir = await dir.getDirectoryHandle(part)
        const handle = await (await dir.getFileHandle(data.name)).createSyncAccessHandle()
        const bytes = new TextEncoder().encode(data.text)
        const half = Math.floor(bytes.length / 2)
        handle.truncate(0)
        handle.write(bytes.subarray(0, half), { at: 0 })
        handle.flush()
        postMessage("half")
        await new Promise((resolve) => setTimeout(resolve, 300))
        handle.write(bytes.subarray(half), { at: half })
        handle.flush()
        handle.close()
        postMessage("done")
      }`

      const worker = new Worker(URL.createObjectURL(new Blob([source])))
      const parts = [...dirs, ...file.split("/")]
      const name = parts.pop()

      const done = new Promise<void>((resolve) => {
        worker.addEventListener("message", ({ data }) => {
          if (data === "done") {
            resolve()
          }
        })
      })

      const half = new Promise<void>((resolve) => {
        worker.addEventListener("message", ({ data }) => {
          if (data === "half") {
            resolve()
          }
        })
      })

      worker.postMessage({ dirs: parts, name, text: content }, [])
      await half
      Object.assign(window, { logseqSaved: done })
    },
    { dirs: root, file: path, content: text },
  )
}

const logseqSaved = async (page: Page) => {
  await page.evaluate(async () => {
    await Reflect.get(window, "logseqSaved")
  })
}

test("Logseq desktop's half-written save of an edit, an add and a delete comes in after the file is still for 2 s, and survives a reload", async ({
  page,
}) => {
  await openFolder(page, og)
  await page.waitForTimeout(1500)
  const day = await openPage(page, "Mar 9th, 2025")

  const saved = [
    "- journal links to [[project/Alpha]] and [[Alpha Project]]",
    "- journal uses a namespaced tag #project/Alpha, edited in Logseq",
    "\t- added in Logseq",
  ].join("\n")

  await logseqDesktopWrites(page, ogFolder, journal, saved)
  await logseqSaved(page)
  await page.waitForTimeout(1000)
  expect(await day.textContent()).toContain("time-tracked task")

  const merged = [
    /^journal links to/,
    "journal uses a namespaced tag #project/Alpha, edited in Logseq",
    "added in Logseq",
  ]

  await expect(day.getByRole("treeitem")).toHaveText(merged, { timeout: 10_000 })
  await page.waitForTimeout(2500)
  expect(await textOf(page, journal)).toBe(saved)
  await expect(page.locator("[data-mirror-report]")).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole("article", { name: "Mar 9th, 2025", exact: true }).getByRole("treeitem"),
  ).toHaveText(merged)
})

test("Logseq desktop's half-written save merges in once, next to an edit typed in seqno meanwhile", async ({
  page,
}) => {
  await openFolder(page, og)
  await page.waitForTimeout(1500)
  const day = await openPage(page, "Mar 9th, 2025")
  await logseqDesktopWrites(
    page,
    ogFolder,
    journal,
    [
      "- journal links to [[project/Alpha]] and [[Alpha Project]]",
      "- journal uses a namespaced tag #project/Alpha, edited in Logseq",
      "\t- added in Logseq",
    ].join("\n"),
  )
  await day.getByRole("treeitem").first().getByText("journal links to").click()
  await page.keyboard.press("End")
  await page.keyboard.type(" (typed in seqno)")
  await page.keyboard.press("Escape")
  await logseqSaved(page)

  const merged = [
    "- journal links to [[project/Alpha]] and [[Alpha Project]] (typed in seqno)",
    "- journal uses a namespaced tag #project/Alpha, edited in Logseq",
    "\t- added in Logseq",
  ].join("\n")

  await expect.poll(async () => await textOf(page, journal), { timeout: 15_000 }).toBe(merged)
  await expect(day.getByRole("treeitem")).toHaveText([
    /journal links to .* \(typed in seqno\)$/,
    "journal uses a namespaced tag #project/Alpha, edited in Logseq",
    "added in Logseq",
  ])
  await page.waitForTimeout(2500)
  expect(await textOf(page, journal)).toBe(merged)
  await expect(page.locator("[data-mirror-report]")).toHaveCount(0)
})

test("a page made in Logseq desktop shows up in seqno, and one deleted there leaves seqno", async ({
  page,
}) => {
  await openFolder(page, og)
  await page.waitForTimeout(1500)
  await writeOpfsFile(page, ogFolder, "pages/made in logseq.md", "- hello from Logseq\n\t- child")
  await removeOpfsEntry(page, ogFolder, "pages/headings.md")
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await page.waitForTimeout(4000)
  const made = await openPage(page, "made in logseq")
  await expect(made.getByRole("treeitem")).toHaveText(["hello from Logseq", "child"], {
    timeout: 15_000,
  })
  await page.keyboard.press("Control+k")
  await page.getByRole("searchbox", { name: "Search" }).fill("headings")
  await expect(page.getByRole("option", { name: "headings", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  expect(await textOf(page, "pages/made in logseq.md")).toBe("- hello from Logseq\n\t- child")
  expect(await textOf(page, "logseq/.recycle/pages_headings.md")).toBeNull()
})

const lockFile = async (page: Page, root: readonly string[], path: string) => {
  await page.evaluate(
    async ({ dirs, file }) => {
      const source = `onmessage = async ({ data }) => {
        if (data === "release") { self.handle.close(); postMessage("released"); return }
        let dir = await navigator.storage.getDirectory()
        for (const part of data.dirs) dir = await dir.getDirectoryHandle(part)
        self.handle = await (await dir.getFileHandle(data.name)).createSyncAccessHandle()
        postMessage("locked")
      }`

      const worker = new Worker(URL.createObjectURL(new Blob([source])))
      const parts = [...dirs, ...file.split("/")]
      const name = parts.pop()

      const reply = async () =>
        await new Promise<unknown>((resolve) => {
          worker.addEventListener("message", resolve, { once: true })
        })

      const locked = reply()
      worker.postMessage({ dirs: parts, name }, [])
      await locked
      Object.assign(window, { lockWorker: worker })
    },
    { dirs: root, file: path },
  )
}

const releaseFile = async (page: Page) => {
  await page.evaluate(async () => {
    const worker = Reflect.get(window, "lockWorker")

    if (!(worker instanceof Worker)) {
      return
    }

    const released = new Promise((resolve) => {
      worker.addEventListener("message", resolve, { once: true })
    })

    worker.postMessage("release", [])
    await released
  })
}

test("a write that fails shows Logseq's notice, and the file catches up once writes work again", async ({
  page,
}) => {
  await openFolder(page, og)
  await page.waitForTimeout(1500)
  await lockFile(page, ogFolder, journal)
  await typeInJournal(page, " (edited)")
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-mirror-report]")).toContainText(
    `Write to the file ${journal} failed`,
  )
  await releaseFile(page)
  await expect.poll(async () => await textOf(page, journal), { timeout: 40_000 }).toBe(ogJournal)
  await expect(page.locator("[data-mirror-report]")).toHaveCount(0)
})

test("a page whose file is an iCloud placeholder isn't written next to it, and stays in seqno", async ({
  page,
}) => {
  await openFolder(page, og)
  await page.waitForTimeout(1500)
  const before = await textOf(page, "pages/headings.md")
  await removeOpfsEntry(page, ogFolder, "pages/headings.md")
  await writeOpfsFile(page, ogFolder, "pages/.headings.md.icloud", "")
  const headings = await openPage(page, "headings")
  await headings.getByRole("treeitem").first().click()
  await page.keyboard.press("Home")
  await page.keyboard.type("seqno ")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(3000)
  expect({ file: await textOf(page, "pages/headings.md"), had: before !== null }).toEqual({
    file: null,
    had: true,
  })
  await expect(headings.getByRole("treeitem").first()).toContainText("seqno ")
})

test("two tabs typing on one page write its file once per tick", async ({ page }) => {
  await openFolder(page, og)
  const other = await page.context().newPage()
  await other.goto(page.url())
  await page.waitForTimeout(1500)
  const day = await openPage(page, "Mar 9th, 2025")
  const otherDay = await openPage(other, "Mar 9th, 2025")
  await day.getByRole("treeitem").first().getByText("journal links to").click()
  await page.keyboard.press("End")
  await otherDay.getByRole("treeitem").nth(1).getByText("namespaced tag").click()
  await other.keyboard.press("End")
  const writes = new Set<number>()
  const start = (await opfsFile(page, ogFolder, journal))?.modified
  await page.keyboard.type(" A")
  await other.keyboard.type(" B")

  for (let tick = 0; tick < 40; tick++) {
    const now = await opfsFile(page, ogFolder, journal)

    if (now !== null && now.modified !== start) {
      writes.add(now.modified)
    }

    await page.waitForTimeout(50)
  }

  const text = (await textOf(page, journal)) ?? ""
  expect({
    writes: writes.size,
    a: text.includes("[[Alpha Project]] A\n"),
    b: text.includes("#project/Alpha B\n"),
  }).toEqual({ writes: 1, a: true, b: true })
})

test("a second device's higher claim stops this tab writing, and Write them from this device takes it back", async ({
  page,
}) => {
  await openFolder(page, og)

  const ownText = async () =>
    (await opfsFile(page, ogFolder, `seen/${await seenName(page)}`))?.text ?? ""

  await expect.poll(ownText, { timeout: 15_000 }).toContain('"mirror"')
  const own = { text: await ownText() }
  const vv = JSON.parse(own.text).vv
  await writeOpfsFile(
    page,
    ogFolder,
    "seen/web-phone.json",
    JSON.stringify({ vv, verified: [], snapshots: [], mirror: { claim: 5, version: vv } }),
  )
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  const settings = page.getByRole("dialog", { name: "Settings" })
  await settings.getByRole("tab", { name: "Version control" }).click()
  await expect(settings).toContainText("Another device writes them (web-phone)", {
    timeout: 10_000,
  })
  await page.keyboard.press("Escape")
  await typeInJournal(page, " (edited)")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(3000)
  expect(await textOf(page, journal)).not.toBe(ogJournal)
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await settings.getByRole("tab", { name: "Version control" }).click()
  await settings.getByRole("button", { name: "Write them from this device" }).click()
  await expect(settings).toContainText("This device writes them", { timeout: 10_000 })
  await expect.poll(async () => await textOf(page, journal), { timeout: 10_000 }).toBe(ogJournal)
})
