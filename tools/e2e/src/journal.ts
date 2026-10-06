const ordinal = (day: number) =>
  day >= 11 && day <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th")

export const journalTitle = (date: Date) =>
  `${date.toLocaleString("en-US", { month: "short" })} ${date.getDate()}${ordinal(date.getDate())}, ${date.getFullYear()}`
