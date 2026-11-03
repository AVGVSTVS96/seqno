export interface Person {
  readonly name: string
  readonly email: string
  readonly timestamp: number
  readonly timezoneOffset: number
}

export interface CommitInfo {
  readonly oid: string
  readonly message: string
  readonly tree: string
  readonly parent: ReadonlyArray<string>
  readonly author: Person
  readonly committer: Person
}

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const two = (n: number) => String(n).padStart(2, "0")

const zone = (offset: number, colon: boolean) => {
  const east = -offset
  const abs = Math.abs(east)
  return `${east < 0 ? "-" : "+"}${two(Math.floor(abs / 60))}${colon ? ":" : ""}${two(abs % 60)}`
}

const local = ({ timestamp, timezoneOffset }: Person) =>
  new Date((timestamp - timezoneOffset * 60) * 1000)

const ago = (seconds: number) => {
  const units: ReadonlyArray<readonly [number, string]> = [
    [60 * 60 * 24 * 365, "year"],
    [60 * 60 * 24 * 30, "month"],
    [60 * 60 * 24 * 7, "week"],
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
  ]
  for (const [size, unit] of units) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`
  }
  return `${seconds} second${seconds === 1 ? "" : "s"} ago`
}

export type DateStyle = "default" | "iso" | "iso-strict" | "short" | "unix" | "raw" | "relative"

export const dateStyles: ReadonlySet<string> = new Set([
  "default",
  "iso",
  "iso8601",
  "iso-strict",
  "iso8601-strict",
  "short",
  "unix",
  "raw",
  "relative",
])

export const formatDate = (person: Person, style: DateStyle, now: Date): string => {
  const at = local(person)
  const ymd = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`
  const hms = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`
  switch (style) {
    case "iso":
      return `${ymd} ${hms} ${zone(person.timezoneOffset, false)}`
    case "iso-strict":
      return `${ymd}T${hms}${zone(person.timezoneOffset, true)}`
    case "short":
      return ymd
    case "unix":
      return String(person.timestamp)
    case "raw":
      return `${person.timestamp} ${zone(person.timezoneOffset, false)}`
    case "relative":
      return ago(Math.max(0, Math.floor(now.getTime() / 1000) - person.timestamp))
    case "default":
      return `${days[at.getUTCDay()]} ${months[at.getUTCMonth()]} ${at.getUTCDate()} ${hms} ${at.getUTCFullYear()} ${zone(person.timezoneOffset, false)}`
  }
}

export const dateStyleOf = (name: string): DateStyle =>
  name === "iso8601"
    ? "iso"
    : name === "iso8601-strict"
      ? "iso-strict"
      : name === "iso" ||
          name === "iso-strict" ||
          name === "short" ||
          name === "unix" ||
          name === "raw" ||
          name === "relative"
        ? name
        : "default"

export const subjectOf = (message: string) => message.split("\n\n")[0]?.replaceAll("\n", " ") ?? ""

export const bodyOf = (message: string) => {
  const at = message.indexOf("\n\n")
  return at === -1 ? "" : message.slice(at + 2)
}

export const short = (oid: string) => oid.slice(0, 7)

const placeholder =
  /%(?:C\([^)]*\)|Cred|Cgreen|Cblue|Creset|an|ae|ad|at|ai|aI|ar|cn|ce|cd|ct|ci|cI|cr|H|h|T|t|P|p|s|b|B|n|%)/g

export const pretty = (template: string, commit: CommitInfo, style: DateStyle, now: Date) =>
  template.replace(placeholder, (token) => {
    if (token.startsWith("%C")) return ""
    switch (token) {
      case "%H":
        return commit.oid
      case "%h":
        return short(commit.oid)
      case "%T":
        return commit.tree
      case "%t":
        return short(commit.tree)
      case "%P":
        return commit.parent.join(" ")
      case "%p":
        return commit.parent.map(short).join(" ")
      case "%an":
        return commit.author.name
      case "%ae":
        return commit.author.email
      case "%ad":
        return formatDate(commit.author, style, now)
      case "%at":
        return String(commit.author.timestamp)
      case "%ai":
        return formatDate(commit.author, "iso", now)
      case "%aI":
        return formatDate(commit.author, "iso-strict", now)
      case "%ar":
        return formatDate(commit.author, "relative", now)
      case "%cn":
        return commit.committer.name
      case "%ce":
        return commit.committer.email
      case "%cd":
        return formatDate(commit.committer, style, now)
      case "%ct":
        return String(commit.committer.timestamp)
      case "%ci":
        return formatDate(commit.committer, "iso", now)
      case "%cI":
        return formatDate(commit.committer, "iso-strict", now)
      case "%cr":
        return formatDate(commit.committer, "relative", now)
      case "%s":
        return subjectOf(commit.message.trimEnd())
      case "%b":
        return bodyOf(commit.message)
      case "%B":
        return commit.message
      case "%n":
        return "\n"
      default:
        return "%"
    }
  })

export const medium = (commit: CommitInfo, style: DateStyle, now: Date) =>
  [
    `commit ${commit.oid}`,
    ...(commit.parent.length > 1 ? [`Merge: ${commit.parent.map(short).join(" ")}`] : []),
    `Author: ${commit.author.name} <${commit.author.email}>`,
    `Date:   ${formatDate(commit.author, style, now)}`,
    "",
    ...commit.message
      .trimEnd()
      .split("\n")
      .map((line) => `    ${line}`),
  ].join("\n")

const escapes: Readonly<Record<string, string>> = {
  "\u0007": "\\a",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\u000b": "\\v",
  "\f": "\\f",
  "\r": "\\r",
  '"': '\\"',
  "\\": "\\\\",
}

export const quotePath = (
  path: string,
  options: { readonly quoteNonAscii: boolean; readonly quoteSpace: boolean },
) => {
  let quoted = false
  let out = ""
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0
    const escape = escapes[char]
    if (escape !== undefined) {
      quoted = true
      out += escape
    } else if (code < 0x20 || code === 0x7f) {
      quoted = true
      out += `\\${code.toString(8).padStart(3, "0")}`
    } else if (code >= 0x80 && options.quoteNonAscii) {
      quoted = true
      for (const byte of new TextEncoder().encode(char)) out += `\\${byte.toString(8)}`
    } else {
      if (char === " " && options.quoteSpace) quoted = true
      out += char
    }
  }
  return quoted ? `"${out}"` : out
}
