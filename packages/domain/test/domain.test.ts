import { assert, describe, it } from "@effect/vitest"
import { Crypto, Effect, Layer, Result, Schema } from "effect"
import {
  BlockId,
  Command,
  DeviceId,
  GraphEvent,
  JournalDay,
  Page,
  newBlockId,
  newPageId,
  normalizePageName,
} from "@seqno/domain"

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by id minting"),
  }),
)

const blockA = "01920000-0000-7000-8000-000000000001"
const blockB = "01920000-0000-7000-8000-000000000002"
const pageA = "01920000-0000-7000-8000-0000000000aa"

const accepts = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  input: unknown,
) => Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

describe("ids", () => {
  it.effect("mints distinct UUIDv7 block and page ids", () =>
    Effect.gen(function* () {
      const first = yield* newBlockId
      const second = yield* newBlockId
      const page = yield* newPageId
      assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      assert.notStrictEqual(first, second)
      assert.isTrue(accepts(BlockId, first))
      assert.isTrue(accepts(Page.fields.id, page))
    }).pipe(Effect.provide(WebCrypto)),
  )

  it("rejects ids that are not UUIDv7", () => {
    assert.isFalse(accepts(BlockId, "3f2b8e9a-4c1d-4e5f-9a7b-1c2d3e4f5a6b"))
    assert.isFalse(accepts(BlockId, "not-a-uuid"))
  })

  it("keeps device ids filename-safe ASCII", () => {
    assert.isTrue(accepts(DeviceId, "macbook-7f3a"))
    assert.isFalse(accepts(DeviceId, "mac/book"))
    assert.isFalse(accepts(DeviceId, "café"))
    assert.isFalse(accepts(DeviceId, ""))
  })
})

describe("pages", () => {
  it("normalizes page names to NFC, trimmed, lowercase", () => {
    assert.strictEqual(normalizePageName("  Café Notes "), "café notes")
  })

  it("accepts a normalized page and rejects a raw title as its name", () => {
    const page = { id: pageA, name: "project x", title: "Project X", journalDay: null, props: {} }
    assert.deepStrictEqual(Schema.encodeSync(Page)(Schema.decodeUnknownSync(Page)(page)), page)
    assert.isFalse(accepts(Page, { ...page, name: "Project X" }))
  })

  it("accepts real journal days only", () => {
    assert.strictEqual(Schema.decodeUnknownSync(JournalDay)(20261006), 20261006)
    assert.isFalse(accepts(JournalDay, 20260230))
    assert.isFalse(accepts(JournalDay, 2026106))
  })
})

const roundTrip = (input: unknown) =>
  Schema.encodeSync(Command)(Schema.decodeUnknownSync(Command)(input))

describe("commands", () => {
  it("decodes an edit and leaves optional fields absent", () => {
    assert.deepStrictEqual(
      roundTrip({ _tag: "EditText", blockId: blockA, from: 2, to: 5, insert: "hey", extra: 1 }),
      { _tag: "EditText", blockId: blockA, from: 2, to: 5, insert: "hey" },
    )
    assert.deepStrictEqual(
      roundTrip({ _tag: "InsertBlock", pageId: pageA, parentId: null, text: "" }),
      {
        _tag: "InsertBlock",
        pageId: pageA,
        parentId: null,
        text: "",
      },
    )
  })

  it("rejects negative offsets, empty selections and unknown tags", () => {
    assert.isFalse(accepts(Command, { _tag: "SplitBlock", blockId: blockA, at: -1 }))
    assert.isFalse(accepts(Command, { _tag: "Indent", blockIds: [] }))
    assert.isFalse(accepts(Command, { _tag: "Explode" }))
  })

  it("targets page and block properties without ambiguity", () => {
    const command = Schema.decodeUnknownSync(Command)({
      _tag: "SetProperty",
      target: { _tag: "PageTarget", pageId: pageA },
      key: "tags",
      value: null,
    })
    const described = Command.match(command, {
      CreatePage: () => "other",
      RenamePage: () => "other",
      DeletePage: () => "other",
      InsertBlock: () => "other",
      EditText: () => "other",
      SplitBlock: () => "other",
      MergeWithPrevious: () => "other",
      Indent: () => "other",
      Outdent: () => "other",
      MoveBlocks: () => "other",
      DeleteBlocks: () => "other",
      SetCollapsed: () => "other",
      SetProperty: ({ target, key }) => `${target._tag}:${key}`,
      Undo: () => "other",
      Redo: () => "other",
    })
    assert.strictEqual(described, "PageTarget:tags")
  })
})

describe("graph events", () => {
  it("round-trips a block upsert through its encoded form", () => {
    const event = {
      _tag: "BlockUpserted" as const,
      block: {
        id: blockB,
        pageId: pageA,
        parentId: blockA,
        text: "see [[project x]]",
        collapsed: false,
        props: { status: "doing" },
      },
      createdAt: 1759700000000,
      updatedAt: 1759700005000,
    }
    const decoded = Schema.decodeUnknownSync(GraphEvent)(event)
    assert.deepStrictEqual(Schema.encodeSync(GraphEvent)(decoded), event)
  })

  it("rejects a moved block without its new page", () => {
    assert.isFalse(accepts(GraphEvent, { _tag: "BlockMoved", blockId: blockA, parentId: null }))
  })
})
