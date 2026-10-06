import { readdir } from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page, Route } from "@playwright/test"

const harnessPath = "/__seqno_e2e__/"
const routes = `**${harnessPath}**`
const pickedFolders = "seqno-e2e-picked"

export const fixtureGraph = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/${name}/`, import.meta.url))

export const seedOpfs = async (page: Page, from: string, to: ReadonlyArray<string>) => {
  const entries = await readdir(from, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry, i) => ({
      path: join(entry.parentPath, entry.name),
      dir: [...to, ...relative(from, entry.parentPath).split(sep).filter(Boolean)],
      name: entry.name,
      url: `${harnessPath}file/${i}`,
    }))
  const served = new Map(files.map((file) => [file.url, file.path]))
  const serve = (route: Route) => {
    const path = served.get(new URL(route.request().url()).pathname)
    return path === undefined
      ? route.fulfill({ contentType: "text/html", body: "<!doctype html>" })
      : route.fulfill({ path })
  }
  await page.route(routes, serve)
  await page.goto(`${harnessPath}seed`)
  await page.evaluate(
    async ({ folder, writes }) => {
      const root = navigator.storage.getDirectory()
      const directory = (path: ReadonlyArray<string>) =>
        path.reduce(
          async (handle, part) => (await handle).getDirectoryHandle(part, { create: true }),
          root,
        )
      await directory(folder)
      await Promise.all(
        writes.map(async ({ dir, name, url }) => {
          const parent = await directory(dir)
          const file = await parent.getFileHandle(name, { create: true })
          const writable = await file.createWritable()
          await writable.write(await (await fetch(url)).blob())
          await writable.close()
        }),
      )
    },
    { folder: to, writes: files },
  )
  await page.unroute(routes, serve)
}

export const opfsFiles = async (page: Page, root: ReadonlyArray<string>) => {
  const files = await page.evaluate(async (path) => {
    const found: Array<[string, Array<number>]> = []
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const entry of dir.values()) {
        if (entry.kind === "file") {
          const bytes = new Uint8Array(await (await entry.getFile()).arrayBuffer())
          found.push([`${prefix}${entry.name}`, [...bytes]])
        } else {
          await walk(entry, `${prefix}${entry.name}/`)
        }
      }
    }
    await walk(
      await path.reduce(
        async (dir, part) => (await dir).getDirectoryHandle(part),
        navigator.storage.getDirectory(),
      ),
      "",
    )
    return found
  }, root)
  return Object.fromEntries(files.map(([path, bytes]) => [path, new Uint8Array(bytes)]))
}

export const loadGraphFolder = async (page: Page, from: string) => {
  const folder = [pickedFolders, basename(from)]
  await seedOpfs(page, from, folder)
  await page.addInitScript((path) => {
    window.showDirectoryPicker = () =>
      path.reduce(
        async (dir, part) => (await dir).getDirectoryHandle(part),
        navigator.storage.getDirectory(),
      )
  }, folder)
}
