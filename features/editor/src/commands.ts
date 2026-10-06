import {
  IconBracketsContain,
  IconBrandYoutube,
  IconCalculator,
  IconCalendar,
  IconCalendarMinus,
  IconCalendarMonth,
  IconCalendarPlus,
  IconCalendarStats,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleHalf,
  IconCircleHalf2,
  IconCircleX,
  IconClock,
  IconClockPause,
  IconCode,
  IconFileSymlink,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconId,
  IconLetterT,
  IconLineDashed,
  IconLink,
  IconListNumbers,
  IconMath,
  IconParentheses,
  IconPhotoShare,
  IconQuote,
  IconSearch,
  IconSourceCode,
  IconSquareRoundedX,
  IconUnderline,
  IconZoomCode,
} from "@tabler/icons-react"
import type { Marker, Priority } from "@seqno/syntax"
import { clockTime, journalTitle, planningDate, shiftDays } from "./dates.ts"
import { priorityBars, type CommandIcon } from "./icons.tsx"
import {
  caretAt,
  insertLink,
  insertText,
  quoteLine,
  setHeading,
  setMarker,
  setOrderedList,
  setPlanning,
  setPriority,
  type Draft,
} from "./format.ts"

export type RefKind = "Page" | "Block"

export interface Applied {
  readonly draft: Draft
  readonly open?: RefKind
}

export interface SlashCommand {
  readonly label: string
  readonly group: string
  readonly icon: CommandIcon
  readonly apply: (draft: Draft, now: Date) => Applied
}

const atEnd = (draft: Draft): Applied => ({ draft: caretAt(draft.text, draft.text.length) })

const text =
  (insert: string, caretFromEnd = 0) =>
  (draft: Draft): Applied => ({ draft: insertText(draft, insert, caretFromEnd) })

const reference =
  (insert: string, caretFromEnd: number, open: RefKind) =>
  (draft: Draft): Applied => ({ draft: insertText(draft, insert, caretFromEnd), open })

const journal = (days: number) => (draft: Draft, now: Date) =>
  text(`[[${journalTitle(shiftDays(now, days))}]]`)(draft)

const fenced = (language: string) => (draft: Draft) => {
  const lineStart = draft.text.lastIndexOf("\n", draft.from - 1) + 1
  const fresh = draft.text.slice(lineStart, draft.from).trim() === ""
  const body = language === "" ? "" : "\n"
  return text(`${fresh ? "" : "\n"}\`\`\`${language}\n${body}\`\`\``, 4)(draft)
}

const command = (
  group: string,
  label: string,
  icon: CommandIcon,
  apply: SlashCommand["apply"],
): SlashCommand => ({ label, group, icon, apply })

const marker = (name: Marker, icon: CommandIcon) =>
  command("TASK STATUS", name, icon, (draft) => atEnd(setMarker(draft, name)))

const heading = (level: number, icon: CommandIcon) =>
  command("Heading", `Heading ${level}`, icon, (draft) => atEnd(setHeading(draft, level)))

const priority = (level: Priority, icon: CommandIcon) =>
  command("PRIORITY", `Priority ${level}`, icon, (draft) => atEnd(setPriority(draft, level)))

const planning = (label: string, kind: "SCHEDULED" | "DEADLINE", icon: CommandIcon) =>
  command("TASK DATE", label, icon, (draft, now) => ({
    draft: setPlanning(draft, kind, planningDate(now)),
  }))

export const slashCommands: ReadonlyArray<SlashCommand> = [
  command("BASIC", "Page reference", IconFileSymlink, reference("[[]]", 2, "Page")),
  command("BASIC", "Page embed", IconId, reference("{{embed [[]]}}", 4, "Page")),
  command("BASIC", "Block reference", IconParentheses, reference("(())", 2, "Block")),
  command("BASIC", "Block embed", IconId, reference("{{embed (())}}", 4, "Block")),
  command("FORMAT", "Link", IconLink, (draft) => ({ draft: insertLink(draft) })),
  command("FORMAT", "Image link", IconPhotoShare, text("![]()", 3)),
  command("FORMAT", "Underline", IconUnderline, text("<ins></ins>", 6)),
  command("FORMAT", "Code block", IconCode, fenced("")),
  command("FORMAT", "Quote", IconQuote, (draft) => ({ draft: quoteLine(draft) })),
  command("FORMAT", "Math block", IconMath, text("$$$$", 2)),
  command("Heading", "Normal text", IconLetterT, (draft) => atEnd(setHeading(draft, null))),
  heading(1, IconH1),
  heading(2, IconH2),
  heading(3, IconH3),
  heading(4, IconH4),
  heading(5, IconH5),
  heading(6, IconH6),
  marker("TODO", IconCircle),
  marker("DOING", IconCircleHalf),
  marker("LATER", IconCircleDashed),
  marker("NOW", IconCircleHalf2),
  marker("DONE", IconCircleCheckFilled),
  marker("WAITING", IconClockPause),
  marker("CANCELED", IconCircleX),
  planning("Deadline", "DEADLINE", IconCalendarStats),
  planning("Scheduled", "SCHEDULED", IconCalendarMonth),
  priority("A", priorityBars(3)),
  priority("B", priorityBars(2)),
  priority("C", priorityBars(1)),
  command("PRIORITY", "No priority", IconLineDashed, (draft) => atEnd(setPriority(draft, null))),
  command("TIME & DATE", "Tomorrow", IconCalendarPlus, journal(1)),
  command("TIME & DATE", "Yesterday", IconCalendarMinus, journal(-1)),
  command("TIME & DATE", "Today", IconCalendar, journal(0)),
  command("TIME & DATE", "Current time", IconClock, (draft, now) => text(clockTime(now))(draft)),
  command("LIST TYPE", "Number list", IconListNumbers, (draft) => ({
    draft: setOrderedList(draft),
  })),
  command("ADVANCED", "Query", IconSearch, text("{{query }}", 2)),
  command("ADVANCED", "Advanced Query", IconSearch, text("#+BEGIN_QUERY\n\n#+END_QUERY", 13)),
  command("ADVANCED", "Query function", IconZoomCode, text("{{function }}", 2)),
  command("ADVANCED", "Calculator", IconCalculator, fenced("calc")),
  command("ADVANCED", "Embed HTML", IconSourceCode, text("@@html: @@", 2)),
  command("ADVANCED", "Embed Video URL", IconBrandYoutube, text("{{video }}", 2)),
  command(
    "ADVANCED",
    "Embed YouTube timestamp",
    IconBrandYoutube,
    text("{{youtube-timestamp }}", 2),
  ),
  command("ADVANCED", "Embed Twitter tweet", IconSquareRoundedX, text("{{tweet }}", 2)),
  command("ADVANCED", "Cloze", IconBracketsContain, text("{{cloze }}", 2)),
]
