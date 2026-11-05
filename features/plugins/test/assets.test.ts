import { describe, expect, it } from "vitest"
import type { Asset } from "@seqno/rpc"
import { assetsApi } from "../src/assets.ts"
import type { AssetBridge } from "../src/assets.ts"
import type { Answer } from "../src/protocol.ts"

const graphOf = (paths: readonly string[]) => {
  const files = new Map<string, string>(paths.map((path) => [path, path]))
  const opened: string[] = []

  const asset = (path: string): Asset => ({
    path,
    url: `data:text/plain,${encodeURIComponent(files.get(path) ?? "")}`,
    size: (files.get(path) ?? "").length,
    modified: 1_700_000_000_000,
  })

  const bridge: AssetBridge = {
    listed: () => [...files.keys()].toSorted().map(asset),
    write: async (path, data) => {
      files.set(path, new TextDecoder().decode(data))

      return await Promise.resolve(asset(path))
    },
    remove: async (path) => {
      files.delete(path)

      await Promise.resolve()
    },
    openPdf: (path) => void opened.push(path),
  }

  return { api: assetsApi(bridge, () => "notes"), files, opened }
}

const call = (
  api: ReturnType<typeof assetsApi>,
  method: string,
  args: readonly unknown[],
): Answer | Promise<Answer> => {
  const run = api[method]

  if (run === undefined) {
    throw new Error(`no ${method}`)
  }

  return run("my-plugin", args)
}

describe("logseq.Assets", () => {
  it("lists the graph's assets with Logseq's fields, filtered by extension", () => {
    const { api } = graphOf(["assets/a.PNG", "assets/b.pdf", "assets/notes"])
    expect(call(api, "list_files_of_current_graph", [["png", ".pdf"]])).toEqual([
      {
        path: "notes/assets/a.PNG",
        size: 12,
        accessTime: 1_700_000_000_000,
        modifiedTime: 1_700_000_000_000,
        changeTime: 1_700_000_000_000,
        birthTime: 1_700_000_000_000,
      },
      {
        path: "notes/assets/b.pdf",
        size: 12,
        accessTime: 1_700_000_000_000,
        modifiedTime: 1_700_000_000_000,
        changeTime: 1_700_000_000_000,
        birthTime: 1_700_000_000_000,
      },
    ])
    expect(call(api, "list_files_of_current_graph", [""])).toEqual([
      expect.objectContaining({ path: "notes/assets/notes" }),
    ])
  })

  it("makes a URL for any form of an asset's path, and opens only PDFs itself", async () => {
    const { api, opened } = graphOf(["assets/a.png", "assets/b.pdf"])
    const url = "data:text/plain,assets%2Fa.png"
    await expect(
      Promise.all(
        ["../assets/a.png", "/assets/a.png", "assets/a.png", "notes/assets/a.png"].map(
          async (path) => await call(api, "make_url", [path]),
        ),
      ),
    ).resolves.toEqual([url, url, url, url])
    expect(call(api, "make_url", ["assets/missing.png"])).toBeNull()
    expect(call(api, "built_in_open", ["../assets/b.pdf"])).toBeNull()
    expect(call(api, "built_in_open", ["../assets/a.png"])).toBe(false)
    expect(call(api, "built_in_open", ["../assets/noext"])).toBeNull()
    expect(opened).toEqual(["../assets/b.pdf"])
  })
})

describe("makeSandboxStorage", () => {
  it("keeps a plugin's items in assets/storages/<id>/ and nowhere else", async () => {
    const { api, files } = graphOf([])
    await expect(
      Promise.resolve(
        call(api, "write_plugin_storage_file", ["my-plugin", "a/b.json", '{"x":1}', true]),
      ),
    ).resolves.toBe("notes/assets/storages/my-plugin/a/b.json")
    await call(api, "write_plugin_storage_file", ["my-plugin", "c.txt", { y: 2 }, true])
    await call(api, "write_plugin_storage_file", [
      "my-plugin",
      "cover.jpg",
      new Uint8Array([106, 112, 101, 103]).buffer,
      true,
    ])
    expect([...files.entries()]).toEqual([
      ["assets/storages/my-plugin/a/b.json", '{"x":1}'],
      ["assets/storages/my-plugin/c.txt", '{"y":2}'],
      ["assets/storages/my-plugin/cover.jpg", "jpeg"],
    ])
    await expect(
      Promise.resolve(call(api, "read_plugin_storage_file", ["my-plugin", "a/b.json", true])),
    ).resolves.toBe('{"x":1}')
    await expect(
      Promise.resolve(call(api, "exist_plugin_storage_file", ["my-plugin", "c.txt", true])),
    ).resolves.toBe(true)
    await expect(
      Promise.resolve(call(api, "list_plugin_storage_files", ["my-plugin", true])),
    ).resolves.toEqual(["a/b.json", "c.txt", "cover.jpg"])
    await expect(
      Promise.resolve(call(api, "write_plugin_storage_file", ["my-plugin", "../../x", "", true])),
    ).rejects.toThrow("write file denied")
    await expect(
      Promise.resolve(call(api, "read_plugin_storage_file", ["my-plugin", "gone", true])),
    ).rejects.toThrow("file not existed")
    await call(api, "unlink_plugin_storage_file", ["my-plugin", "c.txt", true])
    await call(api, "clear_plugin_storage_files", ["my-plugin", true])
    expect([...files.keys()]).toEqual([])
  })
})
