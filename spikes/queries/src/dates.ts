import type { Value } from "./model.ts"

const DAY = 86_400_000

export const ymdToMs = (ymd: number) => Date.UTC(Math.floor(ymd / 10_000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100)

export const msToYmd = (ms: number) => {
  const d = new Date(ms)
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

export const resolveDay = (value: Value, today: number): number | null => {
  if (typeof value !== "object") return null
  if (value._tag === "AbsDate") return value.ymd
  if (value._tag !== "RelDate") return null
  const d = new Date(ymdToMs(today))
  if (value.unit === "d") d.setUTCDate(d.getUTCDate() + value.amount)
  if (value.unit === "w") d.setUTCDate(d.getUTCDate() + 7 * value.amount)
  if (value.unit === "m") d.setUTCMonth(d.getUTCMonth() + value.amount)
  if (value.unit === "y") d.setUTCFullYear(d.getUTCFullYear() + value.amount)
  return msToYmd(d.getTime())
}

export const dayStart = (ymd: number) => ymdToMs(ymd)
export const dayEnd = (ymd: number) => ymdToMs(ymd) + DAY - 1

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

export const parseDateWord = (word: string): Value | null => {
  const w = word.toLowerCase()
  if (w === "today" || w === "now") return { _tag: "RelDate", amount: 0, unit: "d" }
  if (w === "yesterday") return { _tag: "RelDate", amount: -1, unit: "d" }
  if (w === "tomorrow") return { _tag: "RelDate", amount: 1, unit: "d" }
  const rel = /^([+-]\d+)([dwmy])$/.exec(w)
  if (rel) return { _tag: "RelDate", amount: Number(rel[1]), unit: rel[2] as "d" | "w" | "m" | "y" }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w)
  if (iso) return { _tag: "AbsDate", ymd: Number(iso[1]) * 10_000 + Number(iso[2]) * 100 + Number(iso[3]) }
  const journal = /^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?, (\d{4})$/.exec(w)
  if (journal && MONTHS.includes(journal[1]!)) {
    return { _tag: "AbsDate", ymd: Number(journal[3]) * 10_000 + (MONTHS.indexOf(journal[1]!) + 1) * 100 + Number(journal[2]) }
  }
  return null
}
