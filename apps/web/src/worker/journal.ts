import { Clock, Effect, Option } from "effect"
import {
  newBlockId,
  newPageId,
  normalizePageName,
  TYPE_KEY,
  WHITEBOARD_PAGE,
  type Command,
  type JournalDay,
} from "@seqno/domain"
import type { Graph } from "@seqno/graph"
import { defaultConfig, formatJournalDay, parseJournalDay } from "@seqno/interop"
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

export const todaysJournal = (graph: Graph["Service"], format?: "org") =>
  Effect.gen(function* () {
    const today = journalDayOf(yield* Clock.currentTimeMillis)
    const title = formatJournalDay(today, defaultConfig.journalTitleFormat)
    const name = normalizePageName(title)
    const pages = yield* graph.pages
    if (pages.some((page) => page.journalDay === today || page.name === name)) return []
    const pageId = yield* newPageId
    const journal: PageTree = {
      page: {
        id: pageId,
        name,
        title,
        journalDay: today,
        props: {},
        ...(format === undefined ? {} : { format }),
      },
      blocks: [
        { id: yield* newBlockId, pageId, parentId: null, text: "", collapsed: false, props: {} },
      ],
    }
    return [journal]
  })

export const journalDayOfTitle = (title: string) =>
  parseJournalDay(title.trim(), defaultConfig.journalTitleFormat)

export const withJournalDay = (command: Command, format?: "org"): Command => {
  if (command._tag !== "CreatePage") return command
  const { journalDay: _, format: __, ...shaped } = command
  const board = command.props?.[TYPE_KEY] === WHITEBOARD_PAGE
  const rest = format === undefined || board ? shaped : { ...shaped, format }
  return Option.match(journalDayOfTitle(command.title), {
    onNone: () => rest,
    onSome: (journalDay) => ({ ...rest, journalDay }),
  })
}
