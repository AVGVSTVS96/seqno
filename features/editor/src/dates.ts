const ordinal = (day: number) =>
  day >= 11 && day <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th")

const two = (value: number) => String(value).padStart(2, "0")

export const shiftDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

export const journalTitle = (date: Date) =>
  `${date.toLocaleString("en-US", { month: "short" })} ${date.getDate()}${ordinal(date.getDate())}, ${date.getFullYear()}`

export const planningDate = (date: Date) =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${date.toLocaleString("en-US", { weekday: "short" })}`

export const clockTime = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`
