import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { journalTitle } from "../src/journal.ts"
import { loadGraphFolder, opfsFiles, seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

const writeFolder = async (root: string, files: Record<string, Uint8Array | string>) => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}

test("seedOpfs copies a vault folder into OPFS byte for byte", async ({ page }, testInfo) => {
  const vault = {
    "updates/dev-a/0.loro": new Uint8Array([0, 1, 254, 255]),
    "updates/dev-a/42.loro": new Uint8Array([9]),
    "snapshots/3f9a.loro": new Uint8Array([7, 7, 7]),
    "seen/dev-a.json": new Uint8Array([123, 125]),
  }
  await seedOpfs(page, await writeFolder(testInfo.outputPath("vault"), vault), ["graphs", "demo"])
  expect(await opfsFiles(page, ["graphs", "demo"])).toEqual(vault)
})

test("loadGraphFolder hands the seeded folder to the folder picker", async ({ page }, testInfo) => {
  const graph = await writeFolder(testInfo.outputPath("my-graph"), {
    "pages/hello.md": "- hi",
    "journals/2026_10_06.md": "- today",
  })
  await loadGraphFolder(page, graph)
  await page.route("/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  )
  await page.goto("/")
  const picked = await page.evaluate(async () => {
    const folder = await window.showDirectoryPicker()
    const pages = await folder.getDirectoryHandle("pages")
    const hello = await (await pages.getFileHandle("hello.md")).getFile()
    return { name: folder.name, hello: await hello.text() }
  })
  expect(picked).toEqual({ name: "my-graph", hello: "- hi" })
})

test("journal titles follow Logseq's default MMM do, yyyy format", () => {
  const days = [
    new Date(2026, 9, 6),
    new Date(2026, 0, 1),
    new Date(2026, 8, 2),
    new Date(2026, 4, 23),
    new Date(2026, 10, 11),
    new Date(2026, 11, 13),
    new Date(2026, 2, 22),
    new Date(2026, 7, 31),
  ]
  expect(days.map(journalTitle)).toEqual([
    "Oct 6th, 2026",
    "Jan 1st, 2026",
    "Sep 2nd, 2026",
    "May 23rd, 2026",
    "Nov 11th, 2026",
    "Dec 13th, 2026",
    "Mar 22nd, 2026",
    "Aug 31st, 2026",
  ])
})
