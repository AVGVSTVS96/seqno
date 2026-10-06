import { Effect, Match, Option } from "effect"
import type { BlockId, Command, GraphEvent, PageId } from "@seqno/domain"
import type { Replica } from "./ports.ts"
import type { Rng } from "./rng.ts"

export type OpKind =
  | "insertText"
  | "deleteText"
  | "createBlock"
  | "deleteBlock"
  | "moveBlock"
  | "renamePage"
  | "createPage"
  | "deletePage"

export type Counts = Record<OpKind | "cyclePairs" | "rejected", number>

export interface Intent {
  readonly blocks: BlockId[]
  readonly pages: PageId[]
  readonly explicitlyDeleted: Set<string>
  readonly tokens: Map<string, BlockId>
  readonly deadTokens: Set<string>
  readonly counts: Counts
}

const MIX: ReadonlyArray<readonly [OpKind | "cyclePair", number]> = [
  ["insertText", 0.34],
  ["deleteText", 0.08],
  ["createBlock", 0.2],
  ["deleteBlock", 0.05],
  ["moveBlock", 0.2],
  ["renamePage", 0.04],
  ["createPage", 0.03],
  ["deletePage", 0.005],
  ["cyclePair", 0.055],
]

export const createIntent = (): Intent => ({
  blocks: [],
  pages: [],
  explicitlyDeleted: new Set(),
  tokens: new Map(),
  deadTokens: new Set(),
  counts: {
    insertText: 0,
    deleteText: 0,
    createBlock: 0,
    deleteBlock: 0,
    moveBlock: 0,
    renamePage: 0,
    createPage: 0,
    deletePage: 0,
    cyclePairs: 0,
    rejected: 0,
  },
})

const unitEnds = (text: string): ReadonlyArray<number> => {
  const ends = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 32) {
      ends.push(i + 1)
    }
  }
  return ends
}

const TOKEN = /\[\d+\.\d+\]/g

type Parent = { readonly pageId: PageId; readonly parentId: BlockId | null }

export class Workload {
  private seq = 0
  private readonly rng: Rng
  readonly intent: Intent

  constructor(rng: Rng, intent: Intent) {
    this.rng = rng
    this.intent = intent
  }

  pickKind(): OpKind | "cyclePair" {
    let r = this.rng.next()
    for (const [kind, p] of MIX) {
      if (r < p) {
        return kind
      }
      r -= p
    }
    return "insertText"
  }

  apply(replica: Replica, device: number, kind: OpKind): Effect.Effect<boolean> {
    const self = this
    return Effect.gen(function* () {
      const page = yield* self.pickPage(replica)
      const effective = Option.isNone(page) ? "createPage" : kind
      const done = yield* self.run(replica, device, effective)
      if (done) {
        self.intent.counts[effective]++
      }
      return done
    })
  }

  cyclePair(a: Replica, b: Replica): Effect.Effect<boolean> {
    const self = this
    return Effect.gen(function* () {
      for (let i = 0; i < 8; i++) {
        const x = yield* self.pickBlock(a)
        const y = yield* self.pickBlock(a)
        if (Option.isNone(x) || Option.isNone(y) || x.value === y.value) {
          continue
        }
        if (Option.isNone(yield* b.block(x.value)) || Option.isNone(yield* b.block(y.value))) {
          continue
        }
        const first = yield* self.send(a, { _tag: "MoveBlocks", blockIds: [x.value], parentId: y.value })
        if (Option.isNone(first)) {
          continue
        }
        const second = yield* self.send(b, { _tag: "MoveBlocks", blockIds: [y.value], parentId: x.value })
        self.intent.counts.moveBlock += Option.isSome(second) ? 2 : 1
        self.intent.counts.cyclePairs += Option.isSome(second) ? 1 : 0
        return true
      }
      return false
    })
  }

  private token(device: number) {
    return `[${device}.${this.seq++}]`
  }

  private send(replica: Replica, command: Command) {
    return replica.dispatch(command).pipe(
      Effect.map(Option.some),
      Effect.catchTag("CommandRejected", () => {
        this.intent.counts.rejected++
        return Effect.succeed(Option.none<ReadonlyArray<GraphEvent>>())
      }),
    )
  }

  private pickAlive<Id extends string>(
    ids: ReadonlyArray<Id>,
    alive: (id: Id) => Effect.Effect<boolean>,
  ): Effect.Effect<Option.Option<Id>> {
    const rng = this.rng
    return Effect.gen(function* () {
      for (let i = 0; i < 16 && ids.length > 0; i++) {
        const r = rng.next()
        const id = ids[ids.length - 1 - Math.floor(ids.length * r * r)]
        if (id !== undefined && (yield* alive(id))) {
          return Option.some(id)
        }
      }
      return Option.none<Id>()
    })
  }

  private pickBlock(replica: Replica) {
    return this.pickAlive(this.intent.blocks, (id) => Effect.map(replica.block(id), Option.isSome))
  }

  private pickPage(replica: Replica) {
    return this.pickAlive(this.intent.pages, replica.pageAlive)
  }

  private pickParent(replica: Replica): Effect.Effect<Option.Option<Parent>> {
    const self = this
    return Effect.gen(function* () {
      if (!self.rng.chance(0.3)) {
        const block = yield* self.pickBlock(replica)
        if (Option.isSome(block)) {
          const found = yield* replica.block(block.value)
          return Option.map(found, (b): Parent => ({ pageId: b.pageId, parentId: b.id }))
        }
      }
      const page = yield* self.pickPage(replica)
      return Option.map(page, (pageId): Parent => ({ pageId, parentId: null }))
    })
  }

  private pickSlot(replica: Replica, parent: Parent, excluding: BlockId | undefined) {
    const rng = this.rng
    return Effect.map(replica.children(parent.pageId, parent.parentId), (children) => {
      const options = children.filter((child) => child !== excluding)
      const slot = rng.int(0, options.length)
      return slot === 0 ? undefined : options[slot - 1]
    })
  }

  private insertUnit(replica: Replica, blockId: BlockId, device: number) {
    const self = this
    return Effect.gen(function* () {
      const block = yield* replica.block(blockId)
      if (Option.isNone(block)) {
        return false
      }
      const ends = unitEnds(block.value.text)
      const at = ends[self.rng.int(0, ends.length - 1)] ?? 0
      const token = self.token(device)
      const sent = yield* self.send(replica, {
        _tag: "EditText",
        blockId,
        from: at,
        to: at,
        insert: `${token} `,
      })
      if (Option.isSome(sent)) {
        self.intent.tokens.set(token, blockId)
      }
      return Option.isSome(sent)
    })
  }

  private createBlock(replica: Replica, parent: Parent, device: number) {
    const self = this
    return Effect.gen(function* () {
      const after = yield* self.pickSlot(replica, parent, undefined)
      const token = self.token(device)
      const sent = yield* self.send(replica, {
        _tag: "InsertBlock",
        pageId: parent.pageId,
        parentId: parent.parentId,
        ...(after === undefined ? {} : { after }),
        text: `${token} `,
      })
      for (const event of Option.getOrElse(sent, () => [])) {
        if (event._tag === "BlockUpserted") {
          self.intent.blocks.push(event.block.id)
          self.intent.tokens.set(token, event.block.id)
        }
      }
      return Option.isSome(sent)
    })
  }

  private run(replica: Replica, device: number, kind: OpKind): Effect.Effect<boolean> {
    const self = this
    const { intent, rng } = this
    return Match.value(kind).pipe(
      Match.when("insertText", () =>
        Effect.flatMap(self.pickBlock(replica), (block) =>
          Option.isNone(block) ? Effect.succeed(false) : self.insertUnit(replica, block.value, device),
        ),
      ),
      Match.when("deleteText", () =>
        Effect.gen(function* () {
          const picked = yield* self.pickBlock(replica)
          const block = yield* Option.match(picked, {
            onNone: () => Effect.succeed(Option.none()),
            onSome: replica.block,
          })
          if (Option.isNone(block)) {
            return false
          }
          const text = block.value.text
          const ends = unitEnds(text)
          const units = ends.length - 1
          if (units === 0) {
            return false
          }
          const k = rng.int(0, units - 1)
          const n = Math.min(rng.int(1, 3), units - k)
          const from = ends[k] ?? 0
          const to = ends[k + n] ?? from
          const sent = yield* self.send(replica, {
            _tag: "EditText",
            blockId: block.value.id,
            from,
            to,
            insert: "",
          })
          if (Option.isSome(sent)) {
            for (const token of text.slice(from, to).match(TOKEN) ?? []) {
              intent.deadTokens.add(token)
            }
          }
          return Option.isSome(sent)
        }),
      ),
      Match.when("createBlock", () =>
        Effect.flatMap(self.pickParent(replica), (parent) =>
          Option.isNone(parent) ? Effect.succeed(false) : self.createBlock(replica, parent.value, device),
        ),
      ),
      Match.when("deleteBlock", () =>
        Effect.gen(function* () {
          const block = yield* self.pickBlock(replica)
          if (Option.isNone(block)) {
            return false
          }
          const sent = yield* self.send(replica, { _tag: "DeleteBlocks", blockIds: [block.value] })
          if (Option.isSome(sent)) {
            intent.explicitlyDeleted.add(block.value)
          }
          return Option.isSome(sent)
        }),
      ),
      Match.when("moveBlock", () =>
        Effect.gen(function* () {
          const block = yield* self.pickBlock(replica)
          const parent = yield* self.pickParent(replica)
          if (Option.isNone(block) || Option.isNone(parent) || parent.value.parentId === block.value) {
            return false
          }
          const after = yield* self.pickSlot(replica, parent.value, block.value)
          if (parent.value.parentId === null && after === undefined) {
            return false
          }
          const sent = yield* self.send(replica, {
            _tag: "MoveBlocks",
            blockIds: [block.value],
            parentId: parent.value.parentId,
            ...(after === undefined ? {} : { after }),
          })
          return Option.isSome(sent)
        }),
      ),
      Match.when("renamePage", () =>
        Effect.gen(function* () {
          const page = yield* self.pickPage(replica)
          if (Option.isNone(page)) {
            return false
          }
          const sent = yield* self.send(replica, {
            _tag: "RenamePage",
            pageId: page.value,
            title: `page ${device}.${self.seq++}`,
          })
          return Option.isSome(sent)
        }),
      ),
      Match.when("createPage", () =>
        Effect.gen(function* () {
          const sent = yield* self.send(replica, {
            _tag: "CreatePage",
            title: `page ${device}.${self.seq++}`,
          })
          for (const event of Option.getOrElse(sent, () => [])) {
            if (event._tag === "PageUpserted") {
              intent.pages.push(event.page.id)
              yield* self.createBlock(replica, { pageId: event.page.id, parentId: null }, device)
            }
          }
          return Option.isSome(sent)
        }),
      ),
      Match.when("deletePage", () =>
        Effect.gen(function* () {
          const page = yield* self.pickPage(replica)
          if (Option.isNone(page)) {
            return false
          }
          const sent = yield* self.send(replica, { _tag: "DeletePage", pageId: page.value })
          if (Option.isSome(sent)) {
            intent.explicitlyDeleted.add(page.value)
          }
          return Option.isSome(sent)
        }),
      ),
      Match.exhaustive,
    )
  }
}
