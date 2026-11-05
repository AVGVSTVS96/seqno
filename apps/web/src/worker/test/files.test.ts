import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Queue, Stream, SubscriptionRef } from "effect"
import { nodeStorage } from "@seqno/vault/node"
import { makeAppFiles } from "../files.ts"

const graphFolder = Effect.acquireRelease(
  Effect.promise(async () => {
    const root = await mkdtemp(join(tmpdir(), "seqno-app-files-"))
    await mkdir(join(root, "logseq"))
    await writeFile(join(root, "logseq", "config.edn"), "{:meta/version 1}\n")
    await writeFile(join(root, "logseq", "custom.css"), ".ls-block { color: red }\n")

    return root
  }),
  (root) =>
    Effect.promise(async () => {
      await rm(root, { recursive: true, force: true })
    }),
)

describe("a graph's logseq/ files", () => {
  it.effect("lists the ones the graph has, in Logseq's order", () =>
    Effect.gen(function* () {
      const files = yield* makeAppFiles(nodeStorage(yield* graphFolder), Stream.empty)
      assert.deepStrictEqual(yield* SubscriptionRef.get(files.listed), [
        { path: "logseq/config.edn", text: "{:meta/version 1}\n" },
        { path: "logseq/custom.css", text: ".ls-block { color: red }\n" },
      ])
    }).pipe(Effect.scoped),
  )

  it.effect("writes a file to the folder and lists its new text", () =>
    Effect.gen(function* () {
      const root = yield* graphFolder
      const files = yield* makeAppFiles(nodeStorage(root), Stream.empty)
      yield* files.write({ path: "logseq/export.css", text: "h1 { margin: 0 }\n" })
      assert.strictEqual(
        yield* Effect.promise(
          async () => await readFile(join(root, "logseq", "export.css"), "utf-8"),
        ),
        "h1 { margin: 0 }\n",
      )
      assert.deepStrictEqual(
        (yield* SubscriptionRef.get(files.listed)).map((file) => file.path),
        ["logseq/config.edn", "logseq/custom.css", "logseq/export.css"],
      )
    }).pipe(Effect.scoped),
  )

  it.effect("reads a file again when the folder reports a change under logseq/", () =>
    Effect.gen(function* () {
      const root = yield* graphFolder
      const changes = yield* Queue.unbounded<readonly string[]>()
      const files = yield* makeAppFiles(nodeStorage(root), Stream.fromQueue(changes))
      yield* Effect.promise(async () => {
        await writeFile(join(root, "logseq", "custom.css"), ".ls-block { color: blue }\n")
      })
      yield* Queue.offer(changes, ["edit-log/updates/laptop/1.loro"])
      yield* Queue.offer(changes, ["logseq/custom.css"])

      const next = yield* SubscriptionRef.changes(files.listed).pipe(
        Stream.filter((listed) => listed.some((file) => file.text.includes("blue"))),
        Stream.runHead,
      )

      assert.deepStrictEqual(Option.getOrNull(next), [
        { path: "logseq/config.edn", text: "{:meta/version 1}\n" },
        { path: "logseq/custom.css", text: ".ls-block { color: blue }\n" },
      ])
    }).pipe(Effect.scoped),
  )
})
