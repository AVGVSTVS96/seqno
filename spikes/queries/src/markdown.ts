export interface Task {
  readonly status: string | null
  readonly priority: string | null
  readonly scheduled: number | null
  readonly deadline: number | null
}

export interface Parsed {
  readonly task: Task | null
  readonly refs: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  readonly props: ReadonlyArray<readonly [key: string, value: string]>
  readonly propsOnly: boolean
}

const MARKER = /^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELED|CANCELLED)(?=\s|$)/
const PRIORITY = /\[#([ABC])\]/
const DATE_LINE = /^(SCHEDULED|DEADLINE): <(\d{4})-(\d{2})-(\d{2})/gm
const PROPERTY = /^([A-Za-z0-9_-]+):: ?(.*)$/
const WIKI = /\[\[([^\]]+)\]\]/g
const TAG = /(?:^|\s)#(?!\[\[)([^\s#,[\]()]+)|#\[\[([^\]]+)\]\]/g
const CODE = /`[^`\n]*`/g
const LIST_KEYS = new Set(["tags", "alias"])

export const lower = (s: string) => s.trim().toLowerCase()

export const toNum = (value: string): number | null => {
  const n = Number(value)
  return value.trim() !== "" && Number.isFinite(n) ? n : null
}

const propValues = (key: string, raw: string): string[] => {
  const linked = [...raw.matchAll(WIKI)].map((m) => lower(m[1]!))
  for (const m of raw.matchAll(TAG)) linked.push(lower(m[1] ?? m[2]!))
  if (linked.length > 0) return linked
  if (LIST_KEYS.has(key)) return raw.split(",").map(lower).filter((v) => v !== "")
  return [lower(raw)]
}

export const parseBlock = (content: string): Parsed => {
  const text = content.replace(CODE, "")
  const lines = text.split("\n")
  const props: Array<readonly [string, string]> = []
  const propRefs: string[] = []
  let propsOnly = lines.some((l) => l.trim() !== "")
  for (const line of lines) {
    const m = PROPERTY.exec(line)
    if (m === null) {
      if (line.trim() !== "") propsOnly = false
      continue
    }
    const key = m[1]!.toLowerCase()
    const values = propValues(key, m[2]!)
    for (const value of values) props.push([key, value])
    if (LIST_KEYS.has(key) || /\[\[|#/.test(m[2]!)) propRefs.push(...values)
  }
  const tags = new Set<string>()
  for (const m of text.matchAll(TAG)) tags.add(lower(m[1] ?? m[2]!))
  const refs = new Set<string>([...tags, ...propRefs])
  for (const m of text.matchAll(WIKI)) refs.add(lower(m[1]!))

  const marker = MARKER.exec(text)
  const priority = PRIORITY.exec(text)
  let scheduled: number | null = null
  let deadline: number | null = null
  for (const m of text.matchAll(DATE_LINE)) {
    const ymd = Number(m[2]) * 10_000 + Number(m[3]) * 100 + Number(m[4])
    if (m[1] === "SCHEDULED") scheduled ??= ymd
    else deadline ??= ymd
  }
  const task =
    marker || scheduled !== null || deadline !== null
      ? {
          status: marker ? (marker[1] === "CANCELLED" ? "canceled" : marker[1]!.toLowerCase()) : null,
          priority: priority ? priority[1]!.toLowerCase() : null,
          scheduled,
          deadline,
        }
      : null
  return { task, refs: [...refs], tags: [...tags], props, propsOnly }
}

export const namespacesOf = (name: string): string[] => {
  const parts = name.split("/")
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"))
}

export const tokenize = (text: string): string[] | null =>
  /^[\x00-\x7f]*$/.test(text) ? text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t !== "") : null
