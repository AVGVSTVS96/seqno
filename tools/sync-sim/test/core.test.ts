import { assert, describe, it } from "@effect/vitest"
import { Context, Crypto, Effect, Layer, Option, Schema } from "effect"
import { DeviceId, type Command, type GraphEvent, type PageId } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { Index } from "@seqno/index"
import { layerNode } from "@seqno/index/node"
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

const openGraph = (peer: `${number}`) =>
  Layer.build(
    Graph.layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }).pipe(
      Layer.provide(WebCrypto),
    ),
  ).pipe(Effect.map((context) => Context.get(context, Graph)))

const openIndex = Layer.build(Index.layer.pipe(Layer.provide(layerNode()))).pipe(
  Effect.map((context) => Context.get(context, Index)),
)

const device = (cloud: FakeCloud, id: string, peer: `${number}`) =>
  Effect.gen(function* () {
    const graph = yield* openGraph(peer)
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

const pageOf = (events: ReadonlyArray<GraphEvent>) => {
  const page = events.find((event) => event._tag === "PageUpserted")
  return page?._tag === "PageUpserted" ? page.page.id : assert.fail("no page event")
}

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

  it.effect("the index answers backlinks and search from the graph's events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const index = yield* openIndex
        const dispatch = (command: Command) =>
          Effect.orDie(graph.dispatch(command)).pipe(
            Effect.tap((events) => Effect.orDie(index.apply(events, "v1"))),
          )

        const project = pageOf(yield* dispatch({ _tag: "CreatePage", title: "Project" }))
        const notes = pageOf(yield* dispatch({ _tag: "CreatePage", title: "Notes" }))
        const inserted = yield* dispatch({
          _tag: "InsertBlock",
          pageId: notes,
          parentId: null,
          text: "plan the [[Project]] launch",
        })
        const block = inserted.find((event) => event._tag === "BlockUpserted")
        if (block?._tag !== "BlockUpserted") return assert.fail("InsertBlock emitted no block")

        assert.deepStrictEqual(yield* Effect.orDie(index.backlinks(project)), [
          { blockId: block.block.id, pageId: notes, text: "plan the [[Project]] launch" },
        ])
        assert.deepStrictEqual(yield* Effect.orDie(index.search("launch")), {
          pages: [],
          blocks: [{ blockId: block.block.id, pageId: notes, text: "plan the [[Project]] launch" }],
        })
        assert.deepStrictEqual(yield* Effect.orDie(index.stamp), Option.some("v1"))
      }),
    ),
  )
})
