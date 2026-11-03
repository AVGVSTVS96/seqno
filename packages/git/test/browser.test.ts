import { fileURLToPath } from "node:url"
import { assert, layer } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { chromium } from "playwright"
import { createServer } from "vite"

class Chrome extends Context.Service<
  Chrome,
  { readonly run: (scenario: string) => Effect.Effect<unknown> }
>()("@seqno/git/test/Chrome") {}

const ChromeLive = Layer.effect(
  Chrome,
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const vite = await createServer({
          root: fileURLToPath(new URL("..", import.meta.url)),
          logLevel: "silent",
          server: { host: "127.0.0.1", port: 0 },
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
    yield* Effect.promise(() => page.waitForFunction("'gitScenario' in globalThis"))
    return Chrome.of({
      run: (scenario) =>
        Effect.promise(() => page.evaluate(`globalThis.gitScenario(${JSON.stringify(scenario)})`)),
    })
  }),
)

layer(ChromeLive, { timeout: 60_000 })("git over File System Access in headless Chrome", (it) => {
  it.effect("commits a graph folder into a separate git folder and reads it back", () =>
    Effect.gen(function* () {
      const chrome = yield* Chrome
      assert.deepStrictEqual(yield* chrome.run("commitsAndReadsBack"), {
        before: "?? .gitignore\n?? journals/\n?? pages/\n",
        first: "Committed",
        dirty: " M pages/Tomatoes.md\n",
        second: "Committed",
        log: "ripe\nAuto saved by Logseq\n",
        history: ["ripe", "Auto saved by Logseq"],
        old: "- red\n",
        diff: "pages/Tomatoes.md\n",
        workFolder: [".gitignore", "journals", "pages", "updates"],
        gitFolder: ["HEAD", "config", "index", "objects", "refs"],
      })
    }),
  )

  it.effect("uses the folder's own .git and waits while its index is locked", () =>
    Effect.gen(function* () {
      const chrome = yield* Chrome
      assert.deepStrictEqual(yield* chrome.run("usesTheFoldersOwnGit"), {
        busy: "Busy",
        log: "Auto saved by Logseq\n",
        head: "ref: refs/heads/master\n",
        lockGone: true,
      })
    }),
  )
})
