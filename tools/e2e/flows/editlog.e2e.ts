import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { opfsFiles } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const updates = (page: Page) =>
  page.evaluate(async () => {
    const graph = await (
      await navigator.storage.getDirectory()
    )
      .getDirectoryHandle("graphs")
      .then((graphs) => graphs.getDirectoryHandle("demo"))
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
  const snapshots = Object.keys(await opfsFiles(page, ["graphs", "demo", "snapshots"]))
  expect(snapshots.length).toBe(1)
  await page.reload()
  await expect(seqno.today.getByRole("treeitem").first()).toContainText("0123456789")
})
