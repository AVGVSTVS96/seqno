import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { fixtureGraph, loadGraphFolder, opfsFiles } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const updates = (page: Page) =>
  page.evaluate(async () => {
    const graph = await (
      await navigator.storage.getDirectory()
    )
      .getDirectoryHandle("graphs")
      .then((graphs) => graphs.getDirectoryHandle("demo"))
      .then((demo) => demo.getDirectoryHandle("edit-log"))
    const devices = await graph.getDirectoryHandle("updates")
    let count = 0
    for await (const device of devices.values()) {
      if (device.kind !== "directory") continue
      for await (const _ of device.keys()) count++
    }
    return count
  })

test("a demo graph compacts its own edit log while you type", async ({ page, seqno }) => {
  test.setTimeout(60_000)
  await seqno.openDemoGraph()
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.press("End")
  for (let key = 0; key < 120; key++) {
    await page.keyboard.type(String(key % 10))
    await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved")
  }
  expect(await updates(page)).toBeGreaterThanOrEqual(100)
  await expect.poll(() => updates(page), { timeout: 30_000 }).toBeLessThan(10)
  const snapshots = Object.keys(await opfsFiles(page, ["graphs", "demo", "edit-log", "snapshots"]))
  expect(snapshots.length).toBe(1)
  await page.reload()
  await expect(seqno.today.getByRole("treeitem").first()).toContainText("0123456789")
})

const copyFolder = (page: Page, from: ReadonlyArray<string>, to: ReadonlyArray<string>) =>
  page.evaluate(
    async ({ source, target }) => {
      const root = navigator.storage.getDirectory()
      const at = (path: ReadonlyArray<string>, create: boolean) =>
        path.reduce(async (dir, part) => (await dir).getDirectoryHandle(part, { create }), root)
      const into = await at(target, true)
      const pending = [[await at(source, false), into] as const]
      for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        const [here, there] = next
        for await (const entry of here.values()) {
          if (entry.kind === "directory") {
            pending.push([entry, await there.getDirectoryHandle(entry.name, { create: true })])
          } else {
            const writable = await (
              await there.getFileHandle(entry.name, { create: true })
            ).createWritable()
            await writable.write(await entry.getFile())
            await writable.close()
          }
        }
      }
      const stamp = await (
        await into.getFileHandle("starter-version", { create: true })
      ).createWritable()
      await stamp.write("1")
      await stamp.close()
    },
    { source: from, target: to },
  )

test("a demo graph an older seqno saved as one tree converts when it opens, edits and all", async ({
  page,
  seqno,
}) => {
  await loadGraphFolder(page, fixtureGraph("graphs/og-syntax-mix"))
  await page.goto("/")
  await page.getByRole("button", { name: "Open a folder" }).click()
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.type("written as one tree")
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved")
  const oneTree = Object.keys(await opfsFiles(page, ["seqno-e2e-picked", "og-syntax-mix"]))
  expect(oneTree.filter((path) => path.startsWith("updates/")).length).toBeGreaterThan(0)
  await copyFolder(page, ["seqno-e2e-picked", "og-syntax-mix"], ["graphs", "demo"])

  await page.goto("/graphs")
  await page.getByRole("button", { name: "Open Getting started" }).click()
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText("written as one tree")
  await expect(page.getByRole("article", { name: "Mar 9th, 2025", exact: true })).toBeVisible()
  const converted = Object.keys(await opfsFiles(page, ["graphs", "demo"]))
  expect(converted.filter((path) => /^(updates|snapshots|seen)\//.test(path))).toEqual([])
  expect(converted.filter((path) => path.startsWith("edit-log/snapshots/")).length).toBe(1)
  expect(converted).toContain("edit-log/layout")
  await page.reload()
  await expect(seqno.today.getByRole("treeitem").first()).toHaveText("written as one tree")
})
