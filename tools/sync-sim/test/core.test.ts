import { assert, describe, it } from "@effect/vitest"
import { Context, Crypto, Effect, Layer, Option, Schema } from "effect"
import { DeviceId, type PageId } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { Vault, layer, makeFakeCloud, type FakeCloud } from "@seqno/vault"

const deviceId = Schema.decodeUnknownSync(DeviceId)

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the graph"),
  }),
)

const members = ["mac", "ipad"]

const device = (cloud: FakeCloud, id: string, peer: `${number}`) =>
  Effect.gen(function* () {
    const graph = yield* Layer.build(
      Graph.layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }).pipe(
        Layer.provide(WebCrypto),
      ),
    ).pipe(Effect.map((context) => Context.get(context, Graph)))
    const vault = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* Vault
      }),
      layer({
        device: deviceId(id),
        peer,
        members: members.map((member) => deviceId(member)),
        compactAfterFiles: 1_000_000,
        compactEvery: 0,
      }).pipe(Layer.provide(cloud.layer(id))),
    )
    return {
      graph,
      flush: graph.flush((update) => Effect.orDie(vault.writeUpdate(update.bytes))),
      sync: Effect.orDie(vault.sync(vaultReplica(graph))),
    }
  })

const texts = (graph: Graph["Service"], pageId: PageId) =>
  Effect.map(Effect.orDie(graph.page(pageId)), (tree) => tree.blocks.map((block) => block.text))

describe("graph and vault together", () => {
  it.effect("an edit on one device reaches the other through update files", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cloud = makeFakeCloud({
          seed: 1,
          placeholders: "dataless",
          autoDownload: true,
          deliverChance: 1,
        })
        const mac = yield* device(cloud, "mac", "1")
        const ipad = yield* device(cloud, "ipad", "2")

        const created = yield* Effect.orDie(
          mac.graph.dispatch({ _tag: "CreatePage", title: "Inbox" }),
        )
        const page = created.find((event) => event._tag === "PageUpserted")
        if (page?._tag !== "PageUpserted") return assert.fail("CreatePage emitted no page")
        const pageId = page.page.id
        const inserted = yield* Effect.orDie(
          mac.graph.dispatch({ _tag: "InsertBlock", pageId, parentId: null, text: "buy milk" }),
        )
        const block = inserted.find((event) => event._tag === "BlockUpserted")
        if (block?._tag !== "BlockUpserted") return assert.fail("InsertBlock emitted no block")

        yield* mac.flush
        cloud.settle()
        const first = yield* ipad.sync
        assert.deepStrictEqual(first.merged, ["updates/mac/0.loro"])
        assert.deepStrictEqual(
          (yield* ipad.graph.pages).map((p) => p.title),
          ["Inbox"],
        )
        assert.deepStrictEqual(yield* texts(ipad.graph, pageId), ["buy milk"])

        yield* Effect.orDie(
          ipad.graph.dispatch({
            _tag: "EditText",
            blockId: block.block.id,
            from: 4,
            to: 4,
            insert: "oat ",
          }),
        )
        yield* ipad.flush
        cloud.settle()
        yield* mac.sync
        assert.deepStrictEqual(yield* texts(mac.graph, pageId), ["buy oat milk"])
      }),
    ),
  )
})
