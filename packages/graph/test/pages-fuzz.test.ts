import { assert, describe, it } from "@effect/vitest"
import { Context, Crypto, Effect, Layer, Option } from "effect"
import type { BlockId, Command, GraphEvent, Page, PageId } from "@seqno/domain"
import { Graph, PeerId, graphV2Layer } from "@seqno/graph"
import { format } from "./support.ts"

const SEEDS = Number(process.env["SEQNO_FUZZ_SEEDS"] ?? 8)
const STEPS = Number(process.env["SEQNO_FUZZ_STEPS"] ?? 150)
const DEVICES = 3

const random = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const seededCrypto = (next: () => number) =>
  Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => Uint8Array.from({ length: size }, () => Math.floor(next() * 256)),
      digest: () => Effect.die("digest is not used by the graph"),
    }),
  )

interface Placed {
  readonly page: PageId
  readonly parent: BlockId | null
  readonly text: string
}

interface Model {
  readonly pages: Map<PageId, Page>
  readonly blocks: Map<BlockId, Placed>
}

const replay = (model: Model, event: GraphEvent): void => {
  const need = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`${event._tag}: ${what}`)
  }
  switch (event._tag) {
    case "PageUpserted":
      model.pages.set(event.page.id, event.page)
      return
    case "PageDeleted":
      model.pages.delete(event.pageId)
      for (const [id, block] of model.blocks)
        if (block.page === event.pageId) model.blocks.delete(id)
      return
    case "BlockUpserted":
      need(model.pages.has(event.block.pageId), "page not known")
      need(
        event.block.parentId === null || model.blocks.has(event.block.parentId),
        "parent not known",
      )
      model.blocks.set(event.block.id, {
        page: event.block.pageId,
        parent: event.block.parentId,
        text: event.block.text,
      })
      return
    case "BlockMoved": {
      const known = model.blocks.get(event.blockId)
      need(known !== undefined, "block not known")
      need(model.pages.has(event.pageId), "page not known")
      need(event.parentId === null || model.blocks.has(event.parentId), "parent not known")
      if (known !== undefined) {
        model.blocks.set(event.blockId, { ...known, page: event.pageId, parent: event.parentId })
      }
      return
    }
    case "BlockDeleted": {
      const gone = new Set([event.blockId])
      let grew = true
      while (grew) {
        grew = false
        for (const [id, block] of model.blocks) {
          if (block.parent !== null && gone.has(block.parent) && !gone.has(id)) {
            gone.add(id)
            grew = true
          }
        }
      }
      gone.forEach((id) => model.blocks.delete(id))
    }
  }
}

const open = (peer: string, next: () => number) =>
  Layer.build(
    graphV2Layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }).pipe(
      Layer.provide(seededCrypto(next)),
    ),
  ).pipe(Effect.map((context) => Context.get(context, Graph)))

const view = (graph: Graph["Service"]) =>
  Effect.gen(function* () {
    const pages = yield* graph.pages
    return yield* Effect.forEach(pages, (page) => Effect.orDie(graph.page(page.id)))
  })

const run = (seed: number) =>
  Effect.gen(function* () {
    const next = random(seed)
    const pick = <A>(items: ReadonlyArray<A>): A | undefined =>
      items[Math.floor(next() * items.length)]
    const devices = yield* Effect.forEach(
      Array.from({ length: DEVICES }, (_, at) => at),
      (at) =>
        Effect.map(open(String(at + 1), next), (graph) => ({
          graph,
          model: { pages: new Map(), blocks: new Map() } satisfies Model,
          seen: 0,
        })),
    )
    const log: Array<Uint8Array> = []
    const record = (device: (typeof devices)[number], events: ReadonlyArray<GraphEvent>) =>
      events.forEach((event) => replay(device.model, event))
    const save = (device: (typeof devices)[number]) =>
      Effect.map(
        device.graph.flush((update) => Effect.sync(() => void log.push(update.bytes))),
        () => undefined,
      )
    const catchUp = (device: (typeof devices)[number]) =>
      Effect.gen(function* () {
        yield* save(device)
        const fresh = log.slice(device.seen)
        device.seen = log.length
        if (fresh.length > 0) record(device, yield* device.graph.merge(fresh))
        yield* save(device)
      })
    const send = (device: (typeof devices)[number], command: Command) =>
      device.graph.dispatch(command).pipe(
        Effect.map((events) => record(device, events)),
        Effect.catchTag("CommandRejected", () => Effect.void),
      )

    for (let step = 0; step < STEPS; step++) {
      const device = pick(devices)
      if (device === undefined) continue
      if (next() < 0.15) {
        yield* catchUp(device)
        continue
      }
      const trees = yield* view(device.graph)
      const blocks = trees.flatMap((tree) => tree.blocks)
      const page = pick(trees)
      const block = pick(blocks)
      const other = pick(blocks)
      const roll = next()
      if (page === undefined || roll < 0.06) {
        const title = `page ${Math.floor(next() * 6)}`
        yield* send(device, { _tag: "CreatePage", title })
        continue
      }
      if (block === undefined || roll < 0.2) {
        yield* send(device, {
          _tag: "InsertBlock",
          pageId: page.page.id,
          parentId: null,
          ...(block === undefined || block.pageId !== page.page.id ? {} : { after: block.id }),
          text: `t${step}`,
        })
        continue
      }
      const command: Command | undefined =
        roll < 0.3
          ? { _tag: "EditText", blockId: block.id, from: 0, to: 0, insert: `${step}.` }
          : roll < 0.42
            ? other === undefined || other.id === block.id
              ? undefined
              : next() < 0.5
                ? { _tag: "MoveBlocks", blockIds: [block.id], parentId: other.id }
                : { _tag: "MoveBlocks", blockIds: [block.id], parentId: null, after: other.id }
            : roll < 0.5
              ? { _tag: "Indent", blockIds: [block.id] }
              : roll < 0.56
                ? { _tag: "Outdent", blockIds: [block.id] }
                : roll < 0.62
                  ? { _tag: "DeleteBlocks", blockIds: [block.id] }
                  : roll < 0.67
                    ? { _tag: "SplitBlock", blockId: block.id, at: 1 }
                    : roll < 0.71
                      ? { _tag: "MergeWithPrevious", blockId: block.id }
                      : roll < 0.8
                        ? { _tag: "Undo" }
                        : roll < 0.85
                          ? { _tag: "Redo" }
                          : roll < 0.9
                            ? {
                                _tag: "RenamePage",
                                pageId: page.page.id,
                                title: `page ${Math.floor(next() * 6)}`,
                              }
                            : roll < 0.93
                              ? { _tag: "DeletePage", pageId: page.page.id }
                              : {
                                  _tag: "SetProperty",
                                  target: { _tag: "BlockTarget", blockId: block.id },
                                  key: "k",
                                  value: String(step),
                                }
      if (command !== undefined) yield* send(device, command)
    }

    for (let round = 0; round < 4; round++) {
      for (const device of devices) yield* catchUp(device)
    }
    const views = yield* Effect.forEach(devices, ({ graph }) => view(graph))
    const first = JSON.stringify(views[0])
    views.forEach((trees, at) => assert.strictEqual(JSON.stringify(trees), first, `device ${at}`))
    for (const [at, device] of devices.entries()) {
      const trees = nthOf(views, at)
      const ids = trees.flatMap((tree) => tree.blocks.map((one) => one.id))
      assert.strictEqual(new Set(ids).size, ids.length, `a block shows twice on device ${at}`)
      assert.strictEqual(
        new Set(trees.map((tree) => tree.page.name)).size,
        trees.length,
        `two live pages share a name on device ${at}`,
      )
      assert.deepStrictEqual(
        [...device.model.pages.keys()].toSorted(),
        trees.map((tree) => tree.page.id).toSorted(),
        `pages from events on device ${at}`,
      )
      const fromState = new Map(
        trees.flatMap((tree) =>
          tree.blocks.map((one) => [
            one.id,
            { page: one.pageId, parent: one.parentId, text: one.text },
          ]),
        ),
      )
      assert.deepStrictEqual(
        [...device.model.blocks].toSorted(([a], [b]) => (a < b ? -1 : 1)),
        [...fromState].toSorted(([a], [b]) => (a < b ? -1 : 1)),
        `blocks from events on device ${at}`,
      )
    }
  })

const nthOf = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at ${index}`)
  return item
}

describe.runIf(format === "v2")("random edits on three devices", () => {
  const only = process.env["SEQNO_FUZZ_SEED"]
  const from = Number(process.env["SEQNO_FUZZ_FROM"] ?? 1)
  const seeds =
    only === undefined ? Array.from({ length: SEEDS }, (_, at) => from + at) : [Number(only)]
  for (const seed of seeds) {
    it.effect(
      `seed ${seed}: converge, show each block once, and send events that match the state`,
      () => Effect.scoped(run(seed)),
    )
  }
})
