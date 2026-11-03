import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { Effect, SubscriptionRef } from "effect"
import { nodeStorage } from "@seqno/vault/node"
import { makeAssetFiles } from "../assets.ts"

const graphFolder = Effect.acquireRelease(
  Effect.promise(async () => {
    const root = await mkdtemp(join(tmpdir(), "seqno-assets-"))
    await mkdir(join(root, "assets", "storages", "plugin"), { recursive: true })
    await writeFile(join(root, "assets", "cat_1700000000000_0.png"), "png")
    await writeFile(join(root, "assets", "storages", "plugin", "notes.json"), "{}")
    await mkdir(join(root, "pages"))
    await writeFile(join(root, "pages", "page.md"), "- ![cat](../assets/cat_1700000000000_0.png)")
    return root
  }),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

const filesOf = (root: string) => {
  const storage = nodeStorage(root)
  return makeAssetFiles(storage, (path) =>
    Effect.map(storage.read(path), (bytes) => new File([new Uint8Array(bytes)], path)),
  )
}

const text = (url: string) => Effect.promise(async () => (await fetch(url)).text())

const bytes = (value: string) => new TextEncoder().encode(value)

describe("a graph's assets", () => {
  it.effect("lists every file under assets/, each with a URL that reads it", () =>
    Effect.gen(function* () {
      const assets = yield* filesOf(yield* graphFolder)
      const listed = yield* SubscriptionRef.get(assets.listed)
      assert.deepStrictEqual(
        listed.map((asset) => [asset.path, asset.size]),
        [
          ["assets/cat_1700000000000_0.png", 3],
          ["assets/storages/plugin/notes.json", 2],
        ],
      )
      assert.strictEqual(yield* text(listed[0]?.url ?? ""), "png")
    }).pipe(Effect.scoped),
  )

  it.effect("saves a new file under a name no other asset has", () =>
    Effect.gen(function* () {
      const root = yield* graphFolder
      const assets = yield* filesOf(root)
      const first = yield* assets.save("cat_1700000000000_0.png", bytes("second"))
      const second = yield* assets.save("cat_1700000000000_0.png", bytes("third"))
      assert.deepStrictEqual(
        [first.path, second.path],
        ["assets/cat_1700000000000_0_1.png", "assets/cat_1700000000000_0_2.png"],
      )
      assert.strictEqual(yield* text(second.url), "third")
      assert.deepStrictEqual(
        (yield* Effect.promise(() => readdir(join(root, "assets")))).toSorted(),
        [
          "cat_1700000000000_0.png",
          "cat_1700000000000_0_1.png",
          "cat_1700000000000_0_2.png",
          "storages",
        ],
      )
    }).pipe(Effect.scoped),
  )

  it.effect("writes over a file at its path, and removes one", () =>
    Effect.gen(function* () {
      const root = yield* graphFolder
      const assets = yield* filesOf(root)
      const written = yield* assets.write("../assets/storages/plugin/notes.json", bytes('{"a":1}'))
      assert.strictEqual(written.path, "assets/storages/plugin/notes.json")
      assert.strictEqual(yield* text(written.url), '{"a":1}')
      yield* assets.remove("assets/cat_1700000000000_0.png")
      assert.deepStrictEqual(
        (yield* SubscriptionRef.get(assets.listed)).map((asset) => asset.path),
        ["assets/storages/plugin/notes.json"],
      )
      assert.deepStrictEqual(yield* Effect.promise(() => readdir(join(root, "assets"))), [
        "storages",
      ])
    }).pipe(Effect.scoped),
  )

  it.effect("refuses a path outside assets/", () =>
    Effect.gen(function* () {
      const root = yield* graphFolder
      const assets = yield* filesOf(root)
      const outside = yield* Effect.flip(assets.write("assets/../pages/page.md", bytes("x")))
      assert.strictEqual(outside.reason, "not a path inside assets/")
      const removed = yield* Effect.flip(assets.remove("pages/page.md"))
      assert.strictEqual(removed.reason, "not a path inside assets/")
      assert.strictEqual(
        yield* Effect.promise(() => readFile(join(root, "pages", "page.md"), "utf8")),
        "- ![cat](../assets/cat_1700000000000_0.png)",
      )
    }).pipe(Effect.scoped),
  )

  it.effect("picks up files another device put in the folder on the next refresh", () =>
    Effect.gen(function* () {
      const root = yield* graphFolder
      const assets = yield* filesOf(root)
      yield* Effect.promise(() => writeFile(join(root, "assets", "synced.pdf"), "pdf"))
      yield* Effect.promise(() => rm(join(root, "assets", "cat_1700000000000_0.png")))
      yield* assets.refresh
      assert.deepStrictEqual(
        (yield* SubscriptionRef.get(assets.listed)).map((asset) => asset.path),
        ["assets/storages/plugin/notes.json", "assets/synced.pdf"],
      )
    }).pipe(Effect.scoped),
  )
})
