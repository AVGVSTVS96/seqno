import { Effect, Option, Schema } from "effect"
import {
  BlockId,
  normalizePageName,
  type Command,
  type PageId,
  type PropertyTarget,
  type Props,
} from "@seqno/domain"
import { renameInProperty, renameRefs } from "@seqno/syntax"
import type { Session } from "./session.ts"

const REFERRING_BLOCKS = `
SELECT DISTINCT b.id FROM refs r JOIN blocks b ON b.rid = r.block WHERE r.target = ?`

const decodeBlockId = Schema.decodeUnknownOption(BlockId)

const propertyEdits = (
  target: PropertyTarget,
  props: Props,
  renamed: (name: string) => boolean,
  title: string,
): ReadonlyArray<Command> =>
  Object.entries(props).flatMap(([key, value]): ReadonlyArray<Command> => {
    const next = renameInProperty(key, value, renamed, title)
    return next === value ? [] : [{ _tag: "SetProperty", target, key, value: next }]
  })

export const referenceEdits = (session: Session, pageId: PageId, title: string) =>
  Effect.gen(function* () {
    const pages = yield* session.graph.pages
    const page = pages.find((candidate) => candidate.id === pageId)
    if (page === undefined) return []
    const renamed = (name: string) => normalizePageName(name) === page.name
    const rows = yield* Effect.orDie(session.index.query(REFERRING_BLOCKS, [page.name]))
    const blocks = yield* Effect.forEach(
      rows.flatMap(([id]) => Option.toArray(decodeBlockId(id))),
      (blockId) => Effect.option(session.graph.block(blockId)),
    )
    const blockEdits = blocks.flatMap(Option.toArray).flatMap((block) => [
      ...renameRefs(block.text, renamed, title).map((edit): Command => ({
        _tag: "EditText",
        blockId: block.id,
        ...edit,
      })),
      ...propertyEdits({ _tag: "BlockTarget", blockId: block.id }, block.props, renamed, title),
    ])
    const pageEdits = pages.flatMap((other) =>
      propertyEdits({ _tag: "PageTarget", pageId: other.id }, other.props, renamed, title),
    )
    return [...blockEdits, ...pageEdits]
  })
