import { Match } from "effect"
import type { Span } from "./block.ts"

export type MathOpen = "$" | "$$" | "\\(" | "\\["

export interface InlineMath {
  readonly open: MathOpen
  readonly tex: string
  readonly end: number
}

export interface MathBlock {
  readonly tex: string
  readonly span: Span
}

const closers: Record<MathOpen, string> = { $: "$", $$: "$$", "\\(": "\\)", "\\[": "\\]" }

export const mathClose = (open: MathOpen) => closers[open]

const lineStop = (source: string, from: number) => {
  let at = from

  while (at < source.length && source[at] !== "$" && source[at] !== "\n" && source[at] !== "\r") {
    at++
  }

  return at
}

const noInlineEnd = new Set([" ", "(", "[", "{"])

export const inlineMathAt = (source: string, at: number): InlineMath | null => {
  if (source[at] === "$") {
    if (source[at + 1] === "$") {
      const close = lineStop(source, at + 2)

      return source.startsWith("$$", close)
        ? { open: "$$", tex: source.slice(at + 2, close), end: close + 2 }
        : null
    }

    const first = source[at + 1]

    if (first === undefined || first === " ") {
      return null
    }

    const close = lineStop(source, at + 2)

    if (source[close] !== "$") {
      return null
    }

    if (close > at + 2 && noInlineEnd.has(source[close - 1] ?? "")) {
      return null
    }

    return { open: "$", tex: source.slice(at + 1, close), end: close + 1 }
  }

  if (source[at] !== "\\") {
    return null
  }

  const open = Match.value(source[at + 1]).pipe(
    Match.when("[", () => "\\[" as const),
    Match.when("(", () => "\\(" as const),
    Match.orElse(() => null),
  )

  if (open === null || at + 2 >= source.length) {
    return null
  }

  const close = source.indexOf(closers[open], at + 2)

  return close === -1 ? null : { open, tex: source.slice(at + 2, close), end: close + 2 }
}

const BEGIN = /\\begin\{([^}]+)\}[ \t\r\n]*/iuy

export const latexEnvironment = (name: string, content: string) =>
  name === "equation" ? content : `\\begin{${name}}\n${content}\\end{${name}}`

export const mathBlockAt = (text: string, from: number): MathBlock | null => {
  let at = from

  while (text[at] === " " || text[at] === "\t") {
    at++
  }

  if (text.startsWith("$$", at)) {
    const close = text.indexOf("$$", at + 2)

    return close === -1
      ? null
      : { tex: text.slice(at + 2, close), span: { from: at, to: close + 2 } }
  }

  BEGIN.lastIndex = at
  const begin = BEGIN.exec(text)

  if (begin === null) {
    return null
  }

  const name = (begin[1] ?? "").toLowerCase()
  const inner = at + begin[0].length
  const close = text.toLowerCase().indexOf(`\\end{${name}}`, inner)
  const end = close === -1 ? text.length : close + `\\end{${name}}`.length

  return {
    tex: latexEnvironment(name, text.slice(inner, close === -1 ? text.length : close)),
    span: { from: at, to: end },
  }
}

const MAYBE_MATH = /\$|\\[[(]|\\begin\{/iu

export const mathSpans = (text: string, skip: readonly Span[]): readonly Span[] => {
  if (!MAYBE_MATH.test(text)) {
    return []
  }

  const spans: Span[] = []
  let lineStart = true

  for (let at = 0; at < text.length; at++) {
    const skipped = skip.find((span) => at >= span.from && at < span.to)

    if (skipped !== undefined) {
      at = skipped.to - 1
      lineStart = false
      continue
    }

    const char = text[at]

    if (char === "\n") {
      lineStart = true
      continue
    }

    const block = lineStart ? mathBlockAt(text, at) : null
    lineStart = false

    if (block !== null) {
      spans.push(block.span)
      at = block.span.to - 1
      continue
    }

    if (char === "\\" && (text[at + 1] === "\\" || text[at + 1] === "$")) {
      at++
      continue
    }

    const math = inlineMathAt(text, at)

    if (math !== null) {
      spans.push({ from: at, to: math.end })
      at = math.end - 1
    }
  }

  return spans
}
