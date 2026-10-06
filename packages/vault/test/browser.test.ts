import { fileURLToPath } from "node:url"
import { assert, layer } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { chromium } from "playwright"
import { createServer } from "vite"

class Chrome extends Context.Service<
  Chrome,
  { readonly run: (scenario: string) => Effect.Effect<unknown> }
>()("@seqno/vault/test/Chrome") {}

const ChromeLive = Layer.effect(
  Chrome,
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const vite = await createServer({
          root: fileURLToPath(new URL("..", import.meta.url)),
          logLevel: "silent",
          server: { host: "127.0.0.1", port: 0 },
          optimizeDeps: { exclude: ["loro-crdt"] },
        })
        return vite.listen()
      }),
      (vite) => Effect.promise(() => vite.close()),
    )
    const browser = yield* Effect.acquireRelease(
      Effect.promise(() => chromium.launch({ channel: "chrome", headless: true })),
      (chrome) => Effect.promise(() => chrome.close()),
    )
    const page = yield* Effect.promise(() => browser.newPage())
    const origin = server.resolvedUrls?.local[0] ?? ""
    yield* Effect.promise(() => page.goto(new URL("test/browser/index.html", origin).href))
    yield* Effect.promise(() => page.waitForFunction("'vaultScenario' in globalThis"))
    return Chrome.of({
      run: (scenario) =>
        Effect.promise(() =>
          page.evaluate(`globalThis.vaultScenario(${JSON.stringify(scenario)})`),
        ),
    })
  }),
)

layer(ChromeLive, { timeout: 60_000 })("OPFS and directory handles in headless Chrome", (it) => {
  it.effect("writes, overwrites, lists, reads and removes files in nested folders", () =>
    Effect.gen(function* () {
      const chrome = yield* Chrome
      assert.deepStrictEqual(yield* chrome.run("storageRoundTrip"), {
        listed: {
          updates: [{ _tag: "Directory", name: "mac" }],
          seen: [{ _tag: "File", name: "mac.json", placeholder: false }],
        },
        read: { seen: '{"v":2}', update: [1, 2, 3] },
        afterRemove: [],
        neverCreated: [],
        missing: { tag: "FileUnavailable", path: "updates/mac/0.loro" },
      })
    }),
  )

  it.effect("opens a granted directory handle the way a picked folder is opened", () =>
    Effect.gen(function* () {
      const chrome = yield* Chrome
      assert.strictEqual(yield* chrome.run("grantedHandle"), "{}")
    }),
  )

  it.effect("two devices sync and compact, and a third opens from the snapshot", () =>
    Effect.gen(function* () {
      const chrome = yield* Chrome
      assert.deepStrictEqual(yield* chrome.run("threeDevices"), {
        ipadText: "hello opfs",
        snapshotsWritten: 1,
        deleted: ["updates/mac/0.loro", "updates/mac/6.loro"],
        phoneText: "hello opfs",
      })
    }),
  )
})
