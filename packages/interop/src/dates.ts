import { Option, Schema } from "effect"
import { JournalDay } from "@seqno/domain"

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const short = (names: ReadonlyArray<string>) => names.map((name) => name.slice(0, 3))

const tokenGroup = /(yyyy|MMMM|MMM|MM|M|do|dd|d|EEEE|EEE|EE|E|'[^']*')/

const isToken = (index: number) => index % 2 === 1

const quoted = (piece: string) => (piece.startsWith("'") ? piece.slice(1, -1) : piece)

const ordinal = (date: number): string => {
  const ones = date % 10
  const suffix =
    date >= 11 && date <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"
  return `${date}${suffix}`
}

const two = (value: number): string => String(value).padStart(2, "0")

export const formatJournalDay = (day: JournalDay, format: string): string => {
  const year = Math.floor(day / 10000)
  const month = Math.floor(day / 100) % 100
  const date = day % 100
  const monthName = months[month - 1] ?? ""
  const weekdayName = weekdays[new Date(Date.UTC(year, month - 1, date)).getUTCDay()] ?? ""
  const render: Record<string, string> = {
    yyyy: String(year),
    MMMM: monthName,
    MMM: monthName.slice(0, 3),
    MM: two(month),
    M: String(month),
    do: ordinal(date),
    dd: two(date),
    d: String(date),
    EEEE: weekdayName,
    EEE: weekdayName.slice(0, 3),
    EE: weekdayName.slice(0, 3),
    E: weekdayName.slice(0, 3),
  }
  return format
    .split(tokenGroup)
    .map((piece, index) => (isToken(index) ? (render[piece] ?? quoted(piece)) : piece))
    .join("")
}

type Part = "year" | "month" | "monthName" | "date" | "weekday"

const matchers: Record<string, readonly [pattern: string, part: Part]> = {
  yyyy: ["(\\d{4})", "year"],
  MMMM: [`(${months.join("|")})`, "monthName"],
  MMM: [`(${short(months).join("|")})`, "monthName"],
  MM: ["(\\d{2})", "month"],
  M: ["(\\d{1,2})", "month"],
  do: ["(\\d{1,2})(?:st|nd|rd|th)", "date"],
  dd: ["(\\d{2})", "date"],
  d: ["(\\d{1,2})", "date"],
  EEEE: [`(${weekdays.join("|")})`, "weekday"],
  EEE: [`(${short(weekdays).join("|")})`, "weekday"],
  EE: [`(${short(weekdays).join("|")})`, "weekday"],
  E: [`(${short(weekdays).join("|")})`, "weekday"],
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const decodeJournalDay = Schema.decodeUnknownOption(JournalDay)

const monthNumber = (name: string): number =>
  short(months).findIndex((month) => month.toLowerCase() === name.slice(0, 3).toLowerCase()) + 1

export const parseJournalDay = (text: string, format: string): Option.Option<JournalDay> => {
  const pieces = format.split(tokenGroup)
  const source = pieces
    .map((piece, index) =>
      isToken(index) ? (matchers[piece]?.[0] ?? escapeRegExp(quoted(piece))) : escapeRegExp(piece),
    )
    .join("")
  const parts = pieces.flatMap((piece, index) => {
    const matcher = isToken(index) ? matchers[piece] : undefined
    return matcher === undefined ? [] : [matcher[1]]
  })
  const match = new RegExp(`^${source}$`, "i").exec(text.normalize("NFC"))
  if (match === null) return Option.none()
  const captured = (part: Part): string => match[parts.indexOf(part) + 1] ?? ""
  const month = parts.includes("month")
    ? Number(captured("month"))
    : monthNumber(captured("monthName"))
  return decodeJournalDay(Number(captured("year")) * 10000 + month * 100 + Number(captured("date")))
}
