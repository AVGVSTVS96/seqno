import { Effect, Option } from "effect"
import { LoroDoc } from "loro-crdt"
import type { PageId } from "@seqno/domain"
import { ImportFailed, PeerId, peerOf } from "../graph.ts"
import { loader } from "../loader.ts"
import { TREE, livePages, readBlock, walkBlocks, type BlockState } from "../tree.ts"
import { journalPageId } from "./layout.ts"
import { makeTrees } from "./outline.ts"
import { writePage, type PageState } from "./write.ts"

const FORMAT = "seqno-pages-1"
const CONVERTED = "seqno:convert"

export interface Converted {
  readonly snapshot: Uint8Array
  readonly peer: PeerId
  readonly pages: number
  readonly blocks: number
}

const readOneTree = (doc: LoroDoc): Array<PageState> =>
  livePages(doc.getTree(TREE)).map(([root, page]) => {
    const blocks: Array<BlockState> = []
    walkBlocks(root, { pageId: page.id, parentId: null }, (child, at) =>
      Option.map(readBlock(child, at), (state) => {
        blocks.push(state)
        return state.block.id
      }),
    )
    return { page, blocks }
  })

const withJournalIds = (pages: ReadonlyArray<PageState>): ReadonlyArray<PageState> => {
  const firstOfDay = new Map<number, PageId>()
  for (const { page } of pages) {
    if (page.journalDay === null) continue
    const known = firstOfDay.get(page.journalDay)
    if (known === undefined || page.id < known) firstOfDay.set(page.journalDay, page.id)
  }
  return pages.map((state) => {
    const day = state.page.journalDay
    if (day === null || firstOfDay.get(day) !== state.page.id) return state
    const id = journalPageId(day)
    return {
      page: { ...state.page, id },
      blocks: state.blocks.map((read) => ({ ...read, block: { ...read.block, pageId: id } })),
    }
  })
}

const readV1 = (files: ReadonlyArray<Uint8Array>) =>
  Effect.try({
    try: () => {
      const doc = new LoroDoc()
      try {
        loader(doc)(files)
        return withJournalIds(readOneTree(doc)).toSorted((a, b) =>
          a.page.id < b.page.id ? -1 : a.page.id > b.page.id ? 1 : 0,
        )
      } finally {
        doc.free()
      }
    },
    catch: (cause) => new ImportFailed({ reason: String(cause) }),
  })

export const convertOneTree = (files: ReadonlyArray<Uint8Array>) =>
  Effect.gen(function* () {
    const pages = yield* readV1(files)
    const digest = yield* Effect.promise(() =>
      globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify([FORMAT, pages])),
      ),
    )
    const peer = peerOf(new Uint8Array(digest))
    return yield* Effect.sync((): Converted => {
      const doc = new LoroDoc()
      try {
        doc.setPeerId(BigInt(peer))
        const trees = makeTrees(doc)
        for (const state of pages) {
          writePage(trees, state.page.id, state)
          doc.commit({ origin: CONVERTED })
        }
        return {
          snapshot: doc.export({ mode: "snapshot" }),
          peer,
          pages: pages.length,
          blocks: pages.reduce((sum, { blocks }) => sum + blocks.length, 0),
        }
      } finally {
        doc.free()
      }
    })
  })
