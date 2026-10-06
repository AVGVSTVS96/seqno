import { Schema } from "effect"
import type { RelDate, Value } from "./ast.ts"

const DAY = 86_400_000
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

const Unit = Schema.Literals(["d", "w", "m", "y"])
const isUnit = Schema.is(Unit)

export const ymdToMs = (ymd: number) => Date.UTC(Math.floor(ymd / 10_000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100)

export const msToYmd = (ms: number) => {
  const d = new Date(ms)
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

const shift: Record<RelDate["unit"], (d: Date, n: number) => void> = {
  d: (d, n) => d.setUTCDate(d.getUTCDate() + n),
  w: (d, n) => d.setUTCDate(d.getUTCDate() + 7 * n),
  m: (d, n) => d.setUTCMonth(d.getUTCMonth() + n),
  y: (d, n) => d.setUTCFullYear(d.getUTCFullYear() + n),
}

export const resolveDay = (value: Value, today: number): number | null => {
  if (typeof value !== "object" || value._tag === "Context") return null
  if (value._tag === "AbsDate") return value.ymd
  const d = new Date(ymdToMs(today))
  shift[value.unit](d, value.amount)
  return msToYmd(d.getTime())
}

export const dayStart = (ymd: number) => ymdToMs(ymd)
export const dayEnd = (ymd: number) => ymdToMs(ymd) + DAY - 1

const ymd = (year: string, month: number, day: string): Value => ({
  _tag: "AbsDate",
  ymd: Number(year) * 10_000 + month * 100 + Number(day),
})

export const parseDateWord = (word: string): Value | null => {
  const w = word.toLowerCase()
  if (w === "today" || w === "now") return { _tag: "RelDate", amount: 0, unit: "d" }
  if (w === "yesterday") return { _tag: "RelDate", amount: -1, unit: "d" }
  if (w === "tomorrow") return { _tag: "RelDate", amount: 1, unit: "d" }
  const [, amount, unit] = /^([+-]\d+)([dwmy])$/.exec(w) ?? []
  if (amount !== undefined && unit !== undefined && isUnit(unit)) return { _tag: "RelDate", amount: Number(amount), unit }
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w) ?? []
  if (year !== undefined && month !== undefined && day !== undefined) return ymd(year, Number(month), day)
  const [, name, jday, jyear] = /^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?, (\d{4})$/.exec(w) ?? []
  const index = name === undefined ? -1 : MONTHS.indexOf(name)
  if (index >= 0 && jday !== undefined && jyear !== undefined) return ymd(jyear, index + 1, jday)
  return null
}
