import { normalizePageName, type Page, type Props } from "@seqno/domain"

export interface Task {
  readonly status: string | null
  readonly priority: string | null
  readonly scheduled: number | null
  readonly deadline: number | null
}

export type Prop = readonly [key: string, value: string]

export interface BlockFacets {
  readonly refs: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  readonly props: ReadonlyArray<Prop>
  readonly task: Task | null
}

export interface PageFacets {
  readonly namespaces: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  readonly aliases: ReadonlyArray<string>
  readonly props: ReadonlyArray<Prop>
}

export const NO_FACETS: BlockFacets = { refs: [], tags: [], props: [], task: null }

export const TASK_FIELDS = ["status", "priority", "scheduled", "deadline"] as const

const MARKER = /^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELED|CANCELLED)(?=\s|$)/
const PRIORITY = /\[#([ABC])\]/
const DATE_LINE = /^(SCHEDULED|DEADLINE): <(\d{4})-(\d{2})-(\d{2})/gm
const WIKI = /\[\[([^\]]+)\]\]/g
const TAG = /(?:^|\s)#(?!\[\[|\+)([^\s#,[\]()]+)|#\[\[([^\]]+)\]\]/g
const CODE = /`[^`\n]*`/g
const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm
const TAG_TRAILER = /[.:]+$/
const LIST_KEYS = new Set(["tags", "alias"])

const wikiNames = (text: string) =>
  [...text.matchAll(WIKI)].map((m) => normalizePageName(m[1] ?? ""))

const tagOf = (m: RegExpMatchArray) => m[2] ?? (m[1] ?? "").replace(TAG_TRAILER, "")

const tagNames = (text: string) =>
  [...text.matchAll(TAG)]
    .map(tagOf)
    .flatMap((name) => (name === "" ? [] : [normalizePageName(name)]))

export const titleIn = (text: string, name: string): string => {
  const code = withoutCode(text)
  const raw = [
    ...[...code.matchAll(WIKI)].map((m) => m[1] ?? ""),
    ...[...code.matchAll(TAG)].map(tagOf),
  ].find((candidate) => normalizePageName(candidate) === name)
  return raw === undefined ? name : raw.trim()
}

export const toNum = (value: string): number | null => {
  const n = Number(value)
  return value.trim() !== "" && Number.isFinite(n) ? n : null
}

const listItem = (part: string) =>
  normalizePageName(
    part
      .trim()
      .replace(/^\[\[(.*)\]\]$/, "$1")
      .replace(/^#/, ""),
  )

const propValues = (key: string, raw: string): ReadonlyArray<string> => {
  if (LIST_KEYS.has(key))
    return raw
      .split(",")
      .map(listItem)
      .filter((v) => v !== "")
  const linked = [...wikiNames(raw), ...tagNames(raw)]
  return linked.length > 0 ? linked : [normalizePageName(raw)]
}

const propsOf = (props: Props): ReadonlyArray<Prop> =>
  Object.entries(props).flatMap(([rawKey, raw]) => {
    const key = rawKey.toLowerCase()
    return propValues(key, raw).map((value): Prop => [key, value])
  })

const linkedProps = (props: Props): ReadonlyArray<string> =>
  Object.entries(props).flatMap(([rawKey, raw]) => {
    const key = rawKey.toLowerCase()
    return LIST_KEYS.has(key) || /\[\[|#/.test(raw) ? propValues(key, raw) : []
  })

const taskOf = (text: string): Task | null => {
  const marker = MARKER.exec(text)?.[1]
  const priority = PRIORITY.exec(text)?.[1]
  let scheduled: number | null = null
  let deadline: number | null = null
  for (const m of text.matchAll(DATE_LINE)) {
    const day = Number(m[2]) * 10_000 + Number(m[3]) * 100 + Number(m[4])
    if (m[1] === "SCHEDULED") scheduled ??= day
    else deadline ??= day
  }
  if (marker === undefined && scheduled === null && deadline === null) return null
  return {
    status:
      marker === undefined ? null : marker === "CANCELLED" ? "canceled" : marker.toLowerCase(),
    priority: priority === undefined ? null : priority.toLowerCase(),
    scheduled,
    deadline,
  }
}

const withoutCode = (text: string) => text.replace(FENCE, "").replace(CODE, "")

export const blockFacets = (text: string, props: Props): BlockFacets => {
  const code = withoutCode(text)
  const tags = [...new Set(tagNames(code))]
  const refs = [...new Set([...tags, ...linkedProps(props), ...wikiNames(code)])]
  return { refs, tags, props: propsOf(props), task: taskOf(code) }
}

export const namespacesOf = (name: string): ReadonlyArray<string> => {
  const parts = name.split("/")
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"))
}

export const pageFacets = (page: Page): PageFacets => {
  const props = propsOf(page.props)
  const values = (key: string) => [...new Set(props.flatMap(([k, v]) => (k === key ? [v] : [])))]
  return {
    namespaces: namespacesOf(page.name),
    tags: values("tags"),
    aliases: values("alias").filter((alias) => alias !== page.name),
    props,
  }
}

export const symmetricDifference = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const inA = new Set(a)
  const inB = new Set(b)
  return [...new Set([...a.filter((x) => !inB.has(x)), ...b.filter((x) => !inA.has(x))])]
}

export const changedPropKeys = (
  a: ReadonlyArray<Prop>,
  b: ReadonlyArray<Prop>,
): ReadonlyArray<string> => {
  const valuesOf = (props: ReadonlyArray<Prop>, key: string) =>
    props.flatMap(([k, v]) => (k === key ? [v] : [])).join("\u0000")
  const keys = new Set([...a, ...b].map(([key]) => key))
  return [...keys].filter((key) => valuesOf(a, key) !== valuesOf(b, key))
}

export const changedTaskFields = (a: Task | null, b: Task | null) =>
  TASK_FIELDS.filter((field) => (a?.[field] ?? null) !== (b?.[field] ?? null))
