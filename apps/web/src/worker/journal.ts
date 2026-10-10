import { Clock, Effect } from "effect"
import { newBlockId, newPageId, normalizePageName, type JournalDay } from "@seqno/domain"
import type { Graph } from "@seqno/graph"
import { defaultConfig, formatJournalDay } from "@seqno/interop"
import type { PageTree } from "@seqno/rpc"

export const journalDayOf = (millis: number): JournalDay => {
  const date = new Date(millis)
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

export const shiftDay = (day: JournalDay, days: number): JournalDay =>
  journalDayOf(
    new Date(
      Math.floor(day / 10000),
      (Math.floor(day / 100) % 100) - 1,
      (day % 100) + days,
    ).getTime(),
  )

export const journalFile = (day: JournalDay) =>
  `journals/${formatJournalDay(day, defaultConfig.journalFileFormat)}.md`

export const todaysJournal = (graph: Graph["Service"]) =>
  Effect.gen(function* () {
    const today = journalDayOf(yield* Clock.currentTimeMillis)
    const title = formatJournalDay(today, defaultConfig.journalTitleFormat)
    const name = normalizePageName(title)
    const pages = yield* graph.pages
    if (pages.some((page) => page.journalDay === today || page.name === name)) return []
    const pageId = yield* newPageId
    const journal: PageTree = {
      page: { id: pageId, name, title, journalDay: today, props: {} },
      blocks: [
        { id: yield* newBlockId, pageId, parentId: null, text: "", collapsed: false, props: {} },
      ],
    }
    return [journal]
  })
