import { createRng, type Rng } from "./rng.ts"
import * as W from "./words.ts"

export interface GraphOptions {
  readonly seed: number
  readonly blocks: number
  readonly pages: number
  readonly journals: number
}

export const defaultGraphOptions: GraphOptions = { seed: 20261006, blocks: 50_000, pages: 1_500, journals: 365 }

export interface Page {
  readonly id: string
  readonly name: string
  readonly journalDay: number | null
}

export interface Block {
  readonly id: string
  readonly pageId: string
  readonly parentId: string | null
  readonly content: string
}

export interface Graph {
  readonly options: GraphOptions
  readonly pages: readonly Page[]
  /** Grouped by page, depth-first pre-order: a block's position among its siblings is its order of appearance. */
  readonly blocks: readonly Block[]
}

const MIN_LEN = 10
const MAX_LEN = 300

const titleCase = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase())

const normal = (rng: Rng) => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next())

const journalPages = (rng: Rng, count: number): Page[] => {
  const ordinal = (d: number) =>
    d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(2025, 0, 1 + i))
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]
    return {
      id: rng.uuid(),
      name: `${W.months[m]} ${d}${ordinal(d)}, ${y}`,
      journalDay: y * 10_000 + (m + 1) * 100 + d,
    }
  })
}

const namedPages = (rng: Rng, count: number): Page[] => {
  const names = new Set<string>()
  while (names.size < count) {
    const r = rng.next()
    const name =
      r < 0.15
        ? rng.pick(W.nouns)
        : r < 0.6
          ? titleCase(`${rng.pick(W.adjectives)} ${rng.pick(W.nouns)}`)
          : r < 0.8
            ? titleCase(`${rng.pick(W.nouns)} ${rng.pick(W.nouns)}`)
            : `${rng.pick(W.namespaces)}/${titleCase(`${rng.pick(W.adjectives)} ${rng.pick(W.nouns)}`)}`
    if (!/\b(\w+) \1\b/i.test(name)) names.add(name)
  }
  return [...names].map((name) => ({ id: rng.uuid(), name, journalDay: null }))
}

const blockCounts = (rng: Rng, pages: readonly Page[], total: number): number[] => {
  const weights = pages.map((p) =>
    p.journalDay === null ? Math.exp(2.4 + 1.3 * normal(rng)) : 2 + Math.exp(2.2 + 0.6 * normal(rng)),
  )
  const sum = weights.reduce((a, b) => a + b, 0)
  const counts = weights.map((w) => Math.max(1, Math.min(2_000, Math.floor((w * total) / sum))))
  const byWeight = weights.map((_, i) => i).sort((a, b) => weights[b]! - weights[a]! || a - b)
  let diff = total - counts.reduce((a, b) => a + b, 0)
  for (let k = 0; diff !== 0; k = (k + 1) % byWeight.length) {
    const i = byWeight[k]!
    if (diff > 0 && counts[i]! < 2_000) counts[i]!++, diff--
    else if (diff < 0 && counts[i]! > 1) counts[i]!--, diff++
  }
  return counts
}

interface ContentContext {
  readonly rng: Rng
  readonly pages: readonly Page[]
  readonly tagPages: readonly Page[]
  readonly blockIds: readonly string[]
}

const pageRef = ({ rng, pages }: ContentContext) => `[[${pages[rng.skewedIndex(pages.length)]!.name}]]`

const tag = ({ rng, tagPages }: ContentContext) => {
  const name = tagPages[rng.skewedIndex(tagPages.length)]!.name
  return /^[\w/-]+$/.test(name) ? `#${name}` : `#[[${name}]]`
}

const token = (ctx: ContentContext): string => {
  const { rng, blockIds } = ctx
  const r = rng.next()
  if (r < 0.05) return pageRef(ctx)
  if (r < 0.075) return tag(ctx)
  if (r < 0.083 && blockIds.length > 0) return `((${blockIds[rng.int(0, blockIds.length - 1)]}))`
  if (r < 0.098) return `**${rng.pick(W.words)} ${rng.pick(W.words)}**`
  if (r < 0.113) return `\`${rng.pick(W.words)}\``
  if (r < 0.12) {
    const w = rng.pick(W.words)
    return `[${w}](https://example.com/${w}/${rng.int(1, 999)})`
  }
  return rng.pick(W.words)
}

const property = (ctx: ContentContext) => {
  const key = ctx.rng.pick(W.propertyKeys)
  const value =
    key === "tags" || key === "alias"
      ? `${pageRef(ctx)}, ${pageRef(ctx)}`
      : key === "author" || key === "source"
        ? pageRef(ctx)
        : ctx.rng.pick(W.propertyValues)
  return `${key}:: ${value}`
}

const date = (rng: Rng) => {
  const d = new Date(Date.UTC(2025, 0, rng.int(1, 365)))
  const iso = d.toISOString().slice(0, 10)
  return `<${iso} ${W.weekdays[d.getUTCDay()]}>`
}

const text = (ctx: ContentContext, prefix: string, maxLen: number) => {
  const target = Math.min(maxLen, MIN_LEN + Math.floor((MAX_LEN - MIN_LEN) * Math.pow(ctx.rng.next(), 2.2)))
  let s = prefix
  while (s.length < target) {
    const t = token(ctx)
    if (s.length + 1 + t.length > maxLen) {
      if (s.length >= MIN_LEN) break
      continue
    }
    s += (s.length > 0 && !s.endsWith("\n") ? " " : "") + t
  }
  return s
}

const content = (ctx: ContentContext, page: Page, isFirst: boolean): string => {
  const { rng } = ctx
  if (isFirst && page.journalDay === null && rng.chance(0.2)) {
    const lines = Array.from({ length: rng.int(2, 4) }, () => property(ctx))
    const joined = lines.join("\n")
    return joined.length <= MAX_LEN ? joined : lines[0]!
  }
  const suffixes: string[] = []
  const isTask = rng.chance(page.journalDay === null ? 0.1 : 0.25)
  if (isTask && rng.chance(0.3)) suffixes.push(`${rng.chance(0.5) ? "SCHEDULED" : "DEADLINE"}: ${date(rng)}`)
  if (rng.chance(0.06)) suffixes.push(property(ctx))
  const suffix = suffixes.length > 0 ? `\n${suffixes.join("\n")}` : ""
  const prefix = isTask ? rng.pick(W.markers) : ""
  const multiline = rng.chance(0.04)
  const room = MAX_LEN - suffix.length
  const body = multiline
    ? `${text(ctx, prefix, Math.floor(room / 2))}\n${text(ctx, "", Math.floor(room / 2) - 1)}`
    : text(ctx, prefix, room)
  return body + suffix
}

const pageBlocks = (ctx: ContentContext, page: Page, count: number, out: Block[], blockIds: string[]) => {
  const { rng } = ctx
  const deep = rng.chance(page.journalDay === null ? 0.06 : 0.01)
  const maxDepth = deep ? 10 : page.journalDay === null ? rng.int(3, 5) : rng.int(2, 4)
  const stack: string[] = []
  let depth = 1
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      const r = rng.next()
      const pChild = deep ? (depth < 4 ? 0.45 : 0.3) : depth === 1 ? 0.4 : depth === 2 ? 0.3 : 0.2
      if (r < pChild && depth < maxDepth) depth++
      else if (r > pChild + 0.45 && depth > 1) depth = rng.int(1, depth - 1)
    }
    const id = rng.uuid()
    out.push({ id, pageId: page.id, parentId: depth === 1 ? null : stack[depth - 2]!, content: content(ctx, page, i === 0) })
    stack[depth - 1] = id
    stack.length = depth
    blockIds.push(id)
  }
}

export const generateGraph = (options: Partial<GraphOptions> = {}): Graph => {
  const opts = { ...defaultGraphOptions, ...options }
  if (opts.blocks < opts.pages + opts.journals) throw new Error("need at least one block per page")
  const rng = createRng(opts.seed)
  const pages = [...namedPages(rng, opts.pages), ...journalPages(rng, opts.journals)]
  const counts = blockCounts(rng, pages, opts.blocks)
  const blockIds: string[] = []
  const ctx: ContentContext = {
    rng,
    pages,
    tagPages: pages.filter((p) => p.journalDay === null && !p.name.includes("/")),
    blockIds,
  }
  const blocks: Block[] = []
  pages.forEach((page, i) => pageBlocks(ctx, page, counts[i]!, blocks, blockIds))
  return { options: opts, pages, blocks }
}
