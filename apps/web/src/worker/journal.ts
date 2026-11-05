import { Clock, Effect, Option } from "effect"
import { newBlockId, newPageId, normalizePageName, TYPE_KEY, WHITEBOARD_PAGE } from "@seqno/domain"
import type { Command, JournalDay } from "@seqno/domain"
import type { Graph } from "@seqno/graph"
import { defaultConfig, formatJournalDay, parseJournalDay } from "@seqno/interop"
import type { PageTree } from "@seqno/rpc"

export const journalDayOf = (millis: number): JournalDay => {
  const date = new Date(millis)

  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
}

export const shiftDay = (day: JournalDay, days: number): JournalDay =>
  journalDayOf(
    new Date(
      Math.floor(day / 10_000),
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

    if (pages.some((page) => page.journalDay === today || page.name === name)) {
      return []
    }

    const pageId = yield* newPageId

    const page = { id: pageId, name, title, journalDay: today, props: {} }

    const journal: PageTree = {
      page: format === undefined ? page : { ...page, format },
      blocks: [
        { id: yield* newBlockId, pageId, parentId: null, text: "", collapsed: false, props: {} },
      ],
    }

    return [journal]
  })

export const journalDayOfTitle = (title: string) =>
  parseJournalDay(title.trim(), defaultConfig.journalTitleFormat)

export const withJournalDay = (command: Command, format?: "org"): Command => {
  if (command._tag !== "CreatePage") {
    return command
  }

  const { journalDay: _, format: __, ...shaped } = command
  const board = command.props?.[TYPE_KEY] === WHITEBOARD_PAGE
  const rest = format === undefined || board ? shaped : { ...shaped, format }

  return Option.match(journalDayOfTitle(command.title), {
    onNone: () => rest,
    onSome: (journalDay) => ({ ...rest, journalDay }),
  })
}

export const todayDeleted = (graph: Graph["Service"], commands: readonly Command[]) =>
  Effect.gen(function* () {
    const deleted = new Set(
      commands.flatMap((command) => (command._tag === "DeletePage" ? [command.pageId] : [])),
    )

    if (deleted.size === 0) {
      return Option.none<Command>()
    }

    const today = journalDayOf(yield* Clock.currentTimeMillis)
    const pages = yield* graph.pages

    if (!pages.some((page) => deleted.has(page.id) && page.journalDay === today)) {
      return Option.none<Command>()
    }

    const title = formatJournalDay(today, defaultConfig.journalTitleFormat)

    return Option.some<Command>({ _tag: "CreatePage", title, journalDay: today })
  })
