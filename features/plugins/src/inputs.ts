export interface InputContext {
  readonly currentPage: string | null
  readonly currentBlock: {
    readonly eid: number
    readonly parent: number
    readonly page: string
  } | null
  readonly now: Date
}

const dayOf = (date: Date) =>
  date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()

const shifted = (now: Date, sign: string, amount: number, unit: string) => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const by = sign === "-" ? -amount : amount

  if (unit === "d") {
    date.setDate(date.getDate() + by)
  }

  if (unit === "w") {
    date.setDate(date.getDate() + 7 * by)
  }

  if (unit === "m") {
    date.setMonth(date.getMonth() + by)
  }

  if (unit === "y") {
    date.setFullYear(date.getFullYear() + by)
  }

  return date
}

const timeUnits = (sign: string | null, suffix: string) => {
  if (suffix === "ms") {
    return sign === "+" ? [23, 59, 59, 999] : [0, 0, 0, 0]
  }

  if (suffix === "start") {
    return [0, 0, 0, 0]
  }

  if (suffix === "end") {
    return [23, 59, 59, 999]
  }

  const digits = `${suffix}000000000`

  return [
    Math.min(23, Number(digits.slice(0, 2))),
    Math.min(59, Number(digits.slice(2, 4))),
    Math.min(59, Number(digits.slice(4, 6))),
    Math.min(999, Number(digits.slice(6, 9))),
  ]
}

const at = (date: Date, [hours = 0, minutes = 0, seconds = 0, ms = 0]: readonly number[]) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    seconds,
    ms,
  ).getTime()

export const keywordInput = (name: string, context: InputContext): string | number | null => {
  const { now } = context

  switch (name) {
    case "current-page": {
      return context.currentPage?.toLowerCase() ?? null
    }

    case "query-page": {
      return context.currentBlock?.page ?? null
    }

    case "current-block": {
      return context.currentBlock?.eid ?? null
    }

    case "parent-block": {
      return context.currentBlock?.parent ?? null
    }

    case "today": {
      return dayOf(now)
    }

    case "yesterday": {
      return dayOf(shifted(now, "-", 1, "d"))
    }

    case "tomorrow": {
      return dayOf(shifted(now, "+", 1, "d"))
    }

    case "right-now-ms": {
      return now.getTime()
    }

    case "start-of-today-ms": {
      return at(now, [0, 0, 0, 0])
    }

    case "end-of-today-ms": {
      return at(now, [23, 59, 59, 999])
    }
  }

  const today = /^today-(start|end|\d{2}|\d{4}|\d{6}|\d{9})$/u.exec(name)

  if (today?.[1] !== undefined) {
    return at(now, timeUnits(null, today[1]))
  }

  const relative = /^([+-])(\d+)([dwmy])$/u.exec(name)

  if (relative !== null) {
    const [, sign = "+", amount = "0", unit = "d"] = relative

    return dayOf(shifted(now, sign, Number(amount), unit))
  }

  const timed = /^([+-])(\d+)([dwmy])-(ms|start|end|\d{2,9})$/u.exec(name)

  if (timed !== null) {
    const [, sign = "+", amount = "0", unit = "d", suffix = "start"] = timed

    return at(shifted(now, sign, Number(amount), unit), timeUnits(sign, suffix))
  }

  const old = /^(\d+)d(-before|-after|-before-ms|-after-ms)?$/u.exec(name)

  if (old !== null) {
    const [, amount = "0", kind = ""] = old

    return keywordInput(
      `${kind.includes("after") ? "+" : "-"}${amount}d${kind.endsWith("-ms") ? "-ms" : ""}`,
      context,
    )
  }

  return null
}

const PAGE_REF = /^\[\[(.+)\]\]$/su
const KEYWORD = /^:([^\s,;()[\]{}"]+)$/u

export const resolveInput = (
  input: unknown,
  context: InputContext,
  read: (text: string) => unknown,
): unknown => {
  if (typeof input !== "string") {
    return input
  }

  const text = input.trim()
  const named = KEYWORD.exec(text)?.[1]

  if (named !== undefined) {
    const resolved = keywordInput(named.replace(/^today\//u, ""), context)

    if (resolved !== null) {
      return resolved
    }
  }

  const value = read(input)
  const ref = typeof value === "string" ? PAGE_REF.exec(value)?.[1] : undefined

  return ref === undefined ? value : ref.toLowerCase()
}
