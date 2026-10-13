import { assert, describe, it } from "@effect/vitest"
import { Context, Crypto, Effect, Layer, Option, Schema, Stream } from "effect"
import {
  BlockId,
  DeviceId,
  JournalDay,
  normalizePageName,
  type Command,
  type GraphEvent,
  type PageId,
} from "@seqno/domain"
import { Graph, PeerId, graphV2Layer, journalPageId, vaultReplica } from "@seqno/graph"
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

const device = (cloud: FakeCloud, id: string, peer: `${number}`) =>
  Effect.gen(function* () {
    const graph = Context.get(
      yield* Layer.build(
        graphV2Layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }).pipe(
          Layer.provide(WebCrypto),
        ),
      ),
      Graph,
    )
    const index = Context.get(
      yield* Layer.build(Index.layer.pipe(Layer.provide(layerNode()))),
      Index,
    )
    const vault = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* Vault
      }),
      layer({
        device: deviceId(id),
        members: members.map((member) => deviceId(member)),
        compactAfterFiles: 1_000_000,
        compactEvery: 0,
      }).pipe(Layer.provide(cloud.layer(id))),
    )
    const indexed = (events: ReadonlyArray<GraphEvent>) =>
      Effect.as(Effect.orDie(index.apply(events)), events)
    const replica = vaultReplica({
      ...graph,
      merge: (blobs) => Effect.flatMap(graph.merge(blobs), indexed),
    })
    return {
      graph,
      index,
      run: (command: Command) => Effect.flatMap(Effect.orDie(graph.dispatch(command)), indexed),
      load: (pages: Parameters<Graph["Service"]["load"]>[0]) =>
        Effect.flatMap(graph.load(pages), indexed),
      flush: Effect.asVoid(graph.flush((update) => Effect.orDie(vault.writeUpdate(update.bytes)))),
      sync: Effect.asVoid(Effect.orDie(vault.sync(replica))),
      refill: Effect.orDie(
        Effect.andThen(
          index.start(graph.pages),
          Effect.flatMap(index.unwritten, (pages) =>
            index.refresh(
              Stream.fromIterable(pages).pipe(
                Stream.mapEffect((page) =>
                  Effect.map(graph.pageEvents(page), (events) => [page, events] as const),
                ),
              ),
            ),
          ),
        ),
      ),
    }
  })

type Device = Effect.Success<ReturnType<typeof device>>

const createdPage = (events: ReadonlyArray<GraphEvent>): PageId => {
  const found = events.find((event) => event._tag === "PageUpserted")
  return found?._tag === "PageUpserted" ? found.page.id : assert.fail("no page was created")
}

const createdBlock = (events: ReadonlyArray<GraphEvent>): BlockId => {
  const found = events.find((event) => event._tag === "BlockUpserted")
  return found?._tag === "BlockUpserted" ? found.block.id : assert.fail("no block was created")
}

const seedPage = (on: Device, title: string, lines: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const pageId = createdPage(yield* on.run({ _tag: "CreatePage", title }))
    const ids: Array<BlockId> = []
    const parents: Array<BlockId> = []
    const lastChild = new Map<BlockId | null, BlockId>()
    for (const line of lines) {
      const depth = (line.length - line.trimStart().length) / 2
      const parentId = depth === 0 ? null : (parents[depth - 1] ?? null)
      const after = lastChild.get(parentId)
      const id = createdBlock(
        yield* on.run({
          _tag: "InsertBlock",
          pageId,
          parentId,
          text: line.trimStart(),
          ...(after === undefined ? {} : { after }),
        }),
      )
      ids.push(id)
      parents[depth] = id
      lastChild.set(parentId, id)
    }
    return { pageId, ids }
  })

const nth = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at ${index}`)
  return item
}

const outline = (on: Device, pageId: PageId) =>
  Effect.map(Effect.orDie(on.graph.page(pageId)), ({ blocks }) => {
    const depth = new Map<string, number>()
    return blocks.map((block) => {
      const level = block.parentId === null ? 0 : (depth.get(block.parentId) ?? 0) + 1
      depth.set(block.id, level)
      return `${"  ".repeat(level)}${block.text}`
    })
  })

const ROWS = `SELECT p.id, b.id, coalesce(parent.id, ''), b.content FROM blocks b
JOIN pages p ON p.rid = b.page LEFT JOIN blocks parent ON parent.rid = b.parent`

const indexMatchesGraph = (on: Device) =>
  Effect.gen(function* () {
    const pages = yield* on.graph.pages
    const fromGraph = yield* Effect.forEach(pages, (one) =>
      Effect.map(Effect.orDie(on.graph.page(one.id)), ({ blocks }) =>
        blocks.map((block) => [one.id, block.id, block.parentId ?? "", block.text].join(" ")),
      ),
    )
    const rows = yield* Effect.orDie(on.index.query(ROWS))
    assert.deepStrictEqual(rows.map((row) => row.join(" ")).toSorted(), fromGraph.flat().toSorted())
    const indexedPages = yield* Effect.orDie(on.index.query("SELECT id FROM pages"))
    assert.deepStrictEqual(
      indexedPages.map(([id]) => String(id)).toSorted(),
      pages.map((one) => one.id).toSorted(),
    )
  })

const twoDevices = Effect.gen(function* () {
  const cloud = makeFakeCloud({
    seed: 7,
    placeholders: "dataless",
    autoDownload: true,
    deliverChance: 1,
  })
  const mac = yield* device(cloud, "mac", "1")
  const ipad = yield* device(cloud, "ipad", "2")
  const x = yield* seedPage(mac, "X", ["a", "b", "  b1", "c"])
  const y = yield* seedPage(mac, "Y", ["y"])
  const z = yield* seedPage(mac, "Z", ["z"])
  yield* mac.flush
  cloud.settle()
  yield* ipad.sync
  yield* ipad.refill
  const exchange = Effect.gen(function* () {
    for (let round = 0; round < 3; round++) {
      yield* mac.flush
      yield* ipad.flush
      cloud.settle()
      yield* mac.sync
      yield* ipad.sync
    }
  })
  return {
    mac,
    ipad,
    exchange,
    x: x.pageId,
    y: y.pageId,
    z: z.pageId,
    a: nth(x.ids, 0),
    b: nth(x.ids, 1),
    b1: nth(x.ids, 2),
    yy: nth(y.ids, 0),
    zz: nth(z.ids, 0),
  }
})

const moveTo = (on: Device, blockId: BlockId, after: BlockId) =>
  on.run({ _tag: "MoveBlocks", blockIds: [blockId], parentId: null, after })

describe("pages in their own trees, through the fake iCloud and the real vault", () => {
  it.effect("a block moved to another page keeps an edit and a child made meanwhile", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { mac, ipad, exchange, x, y, b, b1, yy } = yield* twoDevices
        yield* moveTo(mac, b, yy)
        yield* ipad.run({ _tag: "EditText", blockId: b, from: 1, to: 1, insert: " edited" })
        yield* ipad.run({ _tag: "InsertBlock", pageId: x, parentId: b, after: b1, text: "b2" })
        yield* exchange
        for (const on of [mac, ipad]) {
          assert.deepStrictEqual(yield* outline(on, y), ["y", "b edited", "  b1", "  b2"])
          assert.deepStrictEqual(yield* outline(on, x), ["a", "c"])
          const found = yield* Effect.orDie(on.index.search("edited"))
          assert.deepStrictEqual(
            found.blocks.map((hit) => hit.pageId),
            [y],
          )
          yield* indexMatchesGraph(on)
        }
      }),
    ),
  )

  it.effect(
    "a block moved to another page while the other device moves, deletes or indents it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const meanwhile of ["move", "delete", "indent"] as const) {
            const { mac, ipad, exchange, x, y, b, zz } = yield* twoDevices
            const yy = nth((yield* Effect.orDie(mac.graph.page(y))).blocks, 0).id
            yield* moveTo(mac, b, yy)
            if (meanwhile === "move") yield* moveTo(ipad, b, zz)
            if (meanwhile === "delete") yield* ipad.run({ _tag: "DeleteBlocks", blockIds: [b] })
            if (meanwhile === "indent") yield* ipad.run({ _tag: "Indent", blockIds: [b] })
            yield* exchange
            const seen = yield* Effect.forEach([mac, ipad], (on) =>
              Effect.forEach([x, y], (pageId) => outline(on, pageId)),
            )
            assert.deepStrictEqual(seen[0], seen[1], meanwhile)
            for (const on of [mac, ipad]) yield* indexMatchesGraph(on)
            const everywhere = yield* Effect.map(
              Effect.forEach(yield* mac.graph.pages, (one) => outline(mac, one.id)),
              (all) => all.flat().map((line) => line.trim()),
            )
            assert.strictEqual(everywhere.filter((line) => line === "b").length, 1, meanwhile)
          }
        }),
      ),
  )

  it.effect("today's journal written on two devices is one page in one tree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { mac, ipad, exchange } = yield* twoDevices
        const day = Schema.decodeUnknownSync(JournalDay)(20261012)
        const id = journalPageId(day)
        const today = (text: string, block: string) => ({
          page: {
            id,
            name: normalizePageName("Oct 12th, 2026"),
            title: "Oct 12th, 2026",
            journalDay: day,
            props: {},
          },
          blocks: [
            {
              id: Schema.decodeUnknownSync(BlockId)(block),
              pageId: id,
              parentId: null,
              text,
              collapsed: false,
              props: {},
            },
          ],
        })
        yield* mac.load([today("from the mac", "01920000-0000-7000-8000-0000000000a1")])
        yield* ipad.load([today("from the ipad", "01920000-0000-7000-8000-0000000000a2")])
        yield* exchange
        for (const on of [mac, ipad]) {
          const journals = (yield* on.graph.pages).filter((one) => one.journalDay === day)
          assert.deepStrictEqual(
            journals.map((one) => one.id),
            [id],
          )
          assert.deepStrictEqual(yield* outline(on, id), ["from the mac", "from the ipad"])
          yield* indexMatchesGraph(on)
        }
      }),
    ),
  )

  it.effect("two pages with one name merge, with blocks added to the merged-away page", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { mac, ipad, exchange } = yield* twoDevices
        const fromMac = yield* seedPage(mac, "Groceries", ["milk", "bread"])
        const fromIpad = yield* seedPage(ipad, "groceries", ["eggs", "butter"])
        yield* exchange
        const winner = fromMac.pageId < fromIpad.pageId ? fromMac : fromIpad
        const expected =
          winner === fromMac
            ? ["milk", "bread", "eggs", "butter"]
            : ["eggs", "butter", "milk", "bread"]
        for (const on of [mac, ipad]) {
          const groceries = (yield* on.graph.pages).filter((one) => one.name === "groceries")
          assert.deepStrictEqual(
            groceries.map((one) => one.id),
            [winner.pageId],
          )
          assert.deepStrictEqual(yield* outline(on, winner.pageId), expected)
          yield* indexMatchesGraph(on)
        }
      }),
    ),
  )

  it.effect("undo across pages brings a block back with what the other device typed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { mac, ipad, exchange, x, y, b, yy } = yield* twoDevices
        yield* moveTo(mac, b, yy)
        yield* exchange
        yield* ipad.run({ _tag: "EditText", blockId: b, from: 1, to: 1, insert: "!" })
        yield* exchange
        yield* mac.run({ _tag: "Undo" })
        yield* exchange
        for (const on of [mac, ipad]) {
          assert.deepStrictEqual(yield* outline(on, x), ["a", "b!", "  b1", "c"])
          assert.deepStrictEqual(yield* outline(on, y), ["y"])
          yield* indexMatchesGraph(on)
        }
        yield* mac.run({ _tag: "Redo" })
        yield* exchange
        for (const on of [mac, ipad]) {
          assert.deepStrictEqual(yield* outline(on, y), ["y", "b!", "  b1"])
          yield* indexMatchesGraph(on)
        }
      }),
    ),
  )
})
