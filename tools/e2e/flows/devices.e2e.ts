import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Context, Crypto, Effect, Layer, Option, Schema } from "effect"
import { DeviceId } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { Vault, layer as vaultLayer } from "@seqno/vault"
import { layerNode } from "@seqno/vault/node"
import { loadGraphFolder, opfsFiles, seedOpfs } from "../src/opfs.ts"
import type { Page } from "@playwright/test"
import { expect, test } from "../src/test.ts"

const folder = ["seqno-e2e-picked", "two-devices"]

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the graph"),
  }),
)

const phone = Schema.decodeUnknownSync(DeviceId)("phone")

const phoneOn = (root: string) =>
  Effect.gen(function* () {
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

    return { graph, vault }
  })

const textsIn = (root: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { graph } = yield* phoneOn(root)

      const pages = yield* Effect.forEach(yield* graph.pages, (page) =>
        Effect.orDie(graph.page(page.id)),
      )

      return pages.flatMap((page) => page.blocks.map((block) => block.text))
    }),
  )

const onPhone = (root: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { graph, vault } = yield* phoneOn(root)

      const pages = yield* Effect.forEach(yield* graph.pages, (page) =>
        Effect.orDie(graph.page(page.id)),
      )

      const blocks = pages.flatMap((page) => page.blocks)
      const first = blocks.find((one) => one.text === "first")
      const second = blocks.find((one) => one.text === "second")

      if (first === undefined || second === undefined) {
        return yield* Effect.die("the phone is missing a block")
      }

      yield* Effect.orDie(
        graph.dispatch({ _tag: "EditText", blockId: first.id, from: 5, to: 5, insert: " (phone)" }),
      )
      yield* Effect.orDie(graph.dispatch({ _tag: "DeleteBlocks", blockIds: [second.id] }))
      yield* graph.flush((update) => Effect.orDie(vault.writeUpdate(update.bytes)))
    }),
  )

const logCopy = async (page: Page, copy: string) => {
  await rm(copy, { recursive: true, force: true })
  const files = await opfsFiles(page, folder)

  for (const [path, bytes] of Object.entries(files)) {
    if (!/^(updates|snapshots|seen)\//u.test(path)) {
      continue
    }

    await mkdir(dirname(join(copy, path)), { recursive: true })
    await writeFile(join(copy, path), bytes)
  }

  return await Effect.runPromise(textsIn(copy))
}

test("the saved dot shows only once everything typed is in the folder's edit log", async ({
  page,
  seqno,
}, testInfo) => {
  const notes = testInfo.outputPath("two-devices")
  await mkdir(join(notes, "pages"), { recursive: true })
  await writeFile(join(notes, "pages", "inbox.md"), "- inbox")
  await loadGraphFolder(page, notes)
  await page.goto("/")
  await page.getByRole("button", { name: "Open a folder" }).click()
  const dot = page.locator("[data-save-state]")
  const words = ["first", "second", "third", "fourth", "fifth", "sixth"]
  const missing: string[] = []
  await seqno.today.getByRole("treeitem").first().click()

  for (const [at, word] of words.entries()) {
    if (at > 0) {
      await page.keyboard.press("Enter")
    }

    await page.keyboard.type(word)
    await expect(dot).toHaveAttribute("data-save-state", "saved")
    const texts = await logCopy(page, testInfo.outputPath(`log-${word}`))
    missing.push(...words.slice(0, at + 1).filter((typed) => !texts.includes(typed)))
  }

  expect(missing).toEqual([])
})

test("a block you move stays where you put it when your phone deleted it before hearing of the move", async ({
  page,
  seqno,
}, testInfo) => {
  const notes = testInfo.outputPath("two-devices")
  await mkdir(join(notes, "pages"), { recursive: true })
  await writeFile(join(notes, "pages", "inbox.md"), "- inbox")
  await loadGraphFolder(page, notes)
  await page.goto("/")
  await page.getByRole("button", { name: "Open a folder" }).click()
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.type("first")
  await page.keyboard.press("Enter")
  await page.keyboard.type("second")
  await page.keyboard.press("Enter")
  await page.keyboard.type("third")
  await page.keyboard.press("Escape")
  const copy = testInfo.outputPath("phone")

  const copied = async () => {
    await rm(copy, { recursive: true, force: true })
    const files = await opfsFiles(page, folder)

    for (const [path, bytes] of Object.entries(files)) {
      if (!/^(updates|snapshots|seen)\//u.test(path)) {
        continue
      }

      await mkdir(dirname(join(copy, path)), { recursive: true })
      await writeFile(join(copy, path), bytes)
    }

    return await Effect.runPromise(textsIn(copy))
  }

  await expect.poll(copied).toEqual(expect.arrayContaining(["first", "second", "third"]))
  await Effect.runPromise(onPhone(copy))

  await seqno.today.getByRole("treeitem").filter({ hasText: "second" }).click()
  await page.keyboard.press("Alt+Shift+ArrowDown")
  await page.keyboard.press("Escape")
  const today = seqno.today.getByRole("treeitem")
  await expect(today).toHaveText(["first", "third", "second"])
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-save-state", "saved")

  await seedOpfs(await page.context().newPage(), join(copy, "updates", "phone"), [
    ...folder,
    "updates",
    "phone",
  ])
  await expect(today).toHaveText(["first (phone)", "third", "second"], { timeout: 20_000 })
  await page.reload()
  await expect(seqno.today.getByRole("treeitem")).toHaveText(["first (phone)", "third", "second"])
})
