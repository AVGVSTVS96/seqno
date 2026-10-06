import { Clock, Effect } from "effect"
import type { Crypto } from "effect"
import {
  newBlockId,
  newPageId,
  normalizePageName,
  type BlockId,
  type Page,
  type PageId,
  type Props,
} from "@seqno/domain"
import type { Entry, GraphState } from "./graph-state.ts"

interface Outline {
  readonly text: string
  readonly children?: ReadonlyArray<Outline>
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const ordinal = (day: number) => {
  const teen = day % 100 >= 11 && day % 100 <= 13
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th")
  return `${day}${suffix}`
}

export const journalOf = (millis: number) => {
  const date = new Date(millis)
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  return {
    journalDay: year * 10000 + (month + 1) * 100 + day,
    title: `${months[month] ?? ""} ${ordinal(day)}, ${year}`,
  }
}

const outlineEntries = (
  pageId: PageId,
  parentId: BlockId | null,
  outline: ReadonlyArray<Outline>,
  createdAt: number,
): Effect.Effect<ReadonlyArray<Entry>, never, Crypto.Crypto> =>
  Effect.map(
    Effect.forEach(outline, (node) =>
      Effect.flatMap(Effect.orDie(newBlockId), (id) =>
        Effect.map(outlineEntries(pageId, id, node.children ?? [], createdAt), (children) => [
          {
            block: { id, pageId, parentId, text: node.text, collapsed: false, props: {} },
            createdAt,
          },
          ...children,
        ]),
      ),
    ),
    (groups) => groups.flat(),
  )

const seedPage = (title: string, journalDay: number | null, props: Props, outline: ReadonlyArray<Outline>) =>
  Effect.gen(function* () {
    const id = yield* Effect.orDie(newPageId)
    const now = yield* Clock.currentTimeMillis
    const page: Page = { id, name: normalizePageName(title), title, journalDay, props }
    const entries = yield* outlineEntries(id, null, outline, now)
    return { page, entries }
  })

export const seedGraph = (graph: string, demo: boolean) =>
  Effect.gen(function* () {
    const today = journalOf(yield* Clock.currentTimeMillis)
    const journal = yield* seedPage(
      today.title,
      today.journalDay,
      {},
      demo
        ? [
            { text: "Welcome to the seqno demo graph" },
            { text: "Open [[Getting started]] to see how pages link" },
          ]
        : [{ text: "" }],
    )
    const extra = demo
      ? [
          yield* seedPage("Getting started", null, { favorite: "true" }, [
            {
              text: "seqno is a local-first outliner",
              children: [
                { text: "Every block is markdown source" },
                { text: "Click a block to edit it" },
              ],
            },
            { text: "Search lives in the left sidebar, tagged #seqno" },
          ]),
          yield* seedPage("Ideas", null, {}, [{ text: "A page with one block" }]),
        ]
      : []
    const seeded = [journal, ...extra]
    const state: GraphState = {
      graph,
      pages: seeded.map((part) => part.page),
      entries: seeded.flatMap((part) => part.entries),
    }
    return state
  })
