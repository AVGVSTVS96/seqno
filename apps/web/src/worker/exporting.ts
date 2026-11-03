import { Effect, Option, Schema } from "effect"
import { BlockId, normalizePageName, type PageId } from "@seqno/domain"
import { defaultConfig, mirrorPath } from "@seqno/interop"
import type { ExportedTree, PageTree } from "@seqno/rpc"
import type { Session } from "./session.ts"

const decodeBlockId = Schema.decodeUnknownOption(BlockId)
const BLOCK_REF = /\(\(([0-9a-f-]{36})\)\)/gi
const PAGE_EMBED = /\{\{embed\s+\[\[([^\]]+)\]\]\s*\}\}/g
const maxDepth = 5

const exportedOf = (tree: PageTree): ExportedTree => ({
  ...tree,
  path: mirrorPath(tree.page, defaultConfig),
})

const treesOf = (session: Session, ids: ReadonlyArray<PageId>) =>
  Effect.forEach(ids, (id) => Effect.option(session.graph.page(id))).pipe(
    Effect.map((trees) => trees.flatMap((tree) => Option.toArray(tree))),
  )

export const everyPage = (session: Session) =>
  Effect.flatMap(session.graph.pages, (pages) =>
    Effect.map(
      treesOf(
        session,
        pages.map((page) => page.id),
      ),
      (trees) => trees.map(exportedOf),
    ),
  )

export const pagesReached = (session: Session, from: ReadonlyArray<PageId>) =>
  Effect.gen(function* () {
    const byName = new Map((yield* session.graph.pages).map((page) => [page.name, page.id]))
    const reached = new Map<PageId, PageTree>()
    let frontier: ReadonlyArray<PageId> = [...new Set(from)]
    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
      const trees = yield* treesOf(session, frontier)
      const texts = trees.flatMap((tree) => {
        reached.set(tree.page.id, tree)
        return tree.blocks.flatMap((block) => [block.text, ...Object.values(block.props)])
      })
      const refs = texts.flatMap((text) =>
        [...text.matchAll(BLOCK_REF)].flatMap((match) => Option.toArray(decodeBlockId(match[1]))),
      )
      const embedded = texts.flatMap((text) =>
        [...text.matchAll(PAGE_EMBED)].flatMap((match) => {
          const id = byName.get(normalizePageName(match[1] ?? ""))
          return id === undefined ? [] : [id]
        }),
      )
      const referenced = (yield* session.blocks(refs)).map((block) => block.pageId)
      frontier = [...new Set([...embedded, ...referenced])].filter((id) => !reached.has(id))
    }
    return [...reached.values()].map(exportedOf)
  })
