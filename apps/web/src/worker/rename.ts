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

const referenceEdits = (session: Session, pageId: PageId, title: string) =>
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

const BLOCKS_CITING = `
SELECT b.id FROM blocks b WHERE instr(lower(b.content), ?1) > 0
UNION SELECT b.id FROM props p JOIN blocks b ON b.rid = p.block WHERE instr(lower(p.value), ?1) > 0`

const spansOf = (text: string, needle: string) =>
  [...text.matchAll(new RegExp(needle.replace(/[()]/g, "\\$&"), "gi"))].map((match) => match.index)

const reRef = (text: string, from: string, to: string) =>
  spansOf(text, from).reduce(
    (out, at) => `${out.slice(0, at)}${to}${out.slice(at + to.length)}`,
    text,
  )

const blockRefEdits = (session: Session, blockId: BlockId) =>
  Effect.gen(function* () {
    const target = yield* session.graph.mergeTarget(blockId)
    if (Option.isNone(target)) return []
    const from = `((${blockId.toLowerCase()}))`
    const to = `((${target.value}))`
    const rows = yield* Effect.orDie(session.index.query(BLOCKS_CITING, [from]))
    const blocks = yield* Effect.forEach(
      rows.flatMap(([id]) => Option.toArray(decodeBlockId(id))),
      (citing) => Effect.option(session.graph.block(citing)),
    )
    const pages = yield* session.graph.pages
    const propertyRefs = (owner: PropertyTarget, props: Props): ReadonlyArray<Command> =>
      Object.entries(props).flatMap(([key, value]): ReadonlyArray<Command> =>
        spansOf(value, from).length === 0
          ? []
          : [{ _tag: "SetProperty", target: owner, key, value: reRef(value, from, to) }],
      )
    return [
      ...blocks
        .flatMap(Option.toArray)
        .filter((block) => block.id !== blockId)
        .flatMap((block) => [
          ...spansOf(block.text, from).map((at): Command => ({
            _tag: "EditText",
            blockId: block.id,
            from: at,
            to: at + from.length,
            insert: to,
          })),
          ...propertyRefs({ _tag: "BlockTarget", blockId: block.id }, block.props),
        ]),
      ...pages.flatMap((page) => propertyRefs({ _tag: "PageTarget", pageId: page.id }, page.props)),
    ]
  })

export const withReferenceEdits = (
  session: Session,
  command: Command,
): Effect.Effect<ReadonlyArray<Command>> =>
  command._tag === "RenamePage"
    ? Effect.map(referenceEdits(session, command.pageId, command.title), (edits) => [
        command,
        ...edits,
      ])
    : command._tag === "MergeWithPrevious"
      ? Effect.map(blockRefEdits(session, command.blockId), (edits) => [command, ...edits])
      : Effect.succeed([command])
