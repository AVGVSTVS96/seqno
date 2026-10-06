import { Match } from "effect"
import type { Priority, Span } from "./block.ts"
import { BLOCK_REF, MACRO, PRIORITY, TAG, TAG_TRAILER } from "./patterns.ts"

export type LinkTarget =
  | { readonly _tag: "Url"; readonly url: string }
  | { readonly _tag: "Page"; readonly name: string }
  | { readonly _tag: "Block"; readonly uuid: string }

export type Inline =
  | { readonly _tag: "Text"; readonly text: string; readonly span: Span }
  | { readonly _tag: "Code"; readonly code: string; readonly span: Span }
  | {
      readonly _tag: "PageRef"
      readonly name: string
      readonly brackets: boolean
      readonly span: Span
    }
  | { readonly _tag: "Tag"; readonly name: string; readonly span: Span }
  | { readonly _tag: "BlockRef"; readonly uuid: string; readonly span: Span }
  | { readonly _tag: "Macro"; readonly name: string; readonly args: string; readonly span: Span }
  | { readonly _tag: "Priority"; readonly priority: Priority; readonly span: Span }
  | { readonly _tag: "Bold"; readonly children: ReadonlyArray<Inline>; readonly span: Span }
  | { readonly _tag: "Italic"; readonly children: ReadonlyArray<Inline>; readonly span: Span }
  | { readonly _tag: "Strike"; readonly children: ReadonlyArray<Inline>; readonly span: Span }
  | { readonly _tag: "Highlight"; readonly children: ReadonlyArray<Inline>; readonly span: Span }
  | {
      readonly _tag: "Link"
      readonly label: ReadonlyArray<Inline>
      readonly target: LinkTarget
      readonly span: Span
    }
  | { readonly _tag: "Image"; readonly alt: string; readonly url: string; readonly span: Span }

type Emphasis = "Bold" | "Italic" | "Strike" | "Highlight"

const sticky = (pattern: RegExp) => new RegExp(pattern.source, `${pattern.flags.replace("g", "")}y`)

const BLOCK_REF_AT = sticky(BLOCK_REF)
const TAG_AT = sticky(TAG)
const MACRO_AT = sticky(MACRO)
const PRIORITY_AT = sticky(PRIORITY)
const URL_AT = /https?:\/\/[^\s<>()[\]{}"'`]+/y
const URL_TRAILER = /[.,;:!?]+$/
const UUID_REF = /^\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)$/i
const PAGE_TARGET = /^\[\[(.+)\]\]$/
const WORD = /[\p{L}\p{N}]/u

const delimiters: ReadonlyArray<readonly [string, Emphasis]> = [
  ["**", "Bold"],
  ["__", "Bold"],
  ["~~", "Strike"],
  ["==", "Highlight"],
  ["^^", "Highlight"],
  ["*", "Italic"],
  ["_", "Italic"],
]

const matchAt = (pattern: RegExp, source: string, at: number) => {
  pattern.lastIndex = at
  return pattern.exec(source)
}

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)
const isWord = (char: string | undefined) => char !== undefined && WORD.test(char)

const pairedEnd = (source: string, from: number, open: string, close: string): number => {
  let depth = 0
  for (let at = from; at < source.length - 1; at++) {
    if (source.startsWith(open, at)) {
      depth++
      at++
    } else if (source.startsWith(close, at)) {
      depth--
      if (depth === 0) return at + close.length
      at++
    }
  }
  return -1
}

const bracketEnd = (source: string, from: number): number => {
  let depth = 0
  for (let at = from; at < source.length; at++) {
    if (source[at] === "[") depth++
    else if (source[at] === "]") {
      depth--
      if (depth === 0) return at
    }
  }
  return -1
}

const parenEnd = (source: string, from: number): number => {
  let depth = 0
  for (let at = from; at < source.length; at++) {
    if (source[at] === "(") depth++
    else if (source[at] === ")") {
      depth--
      if (depth === 0) return at
    }
  }
  return -1
}

interface Token {
  readonly node: Inline
  readonly end: number
}

const targetOf = (raw: string): LinkTarget => {
  const target = raw.trim()
  const page = PAGE_TARGET.exec(target)
  if (page !== null) return { _tag: "Page", name: (page[1] ?? "").trim() }
  const block = UUID_REF.exec(target)
  if (block !== null) return { _tag: "Block", uuid: (block[1] ?? "").toLowerCase() }
  return { _tag: "Url", url: target.split(/\s+/)[0] ?? "" }
}

const atomAt = (source: string, at: number, base: number): Token | null => {
  const char = source[at]
  const span = (end: number) => ({ from: base + at, to: base + end })
  if (char === "`") {
    const close = source.indexOf("`", at + 1)
    return close === -1
      ? null
      : {
          node: { _tag: "Code", code: source.slice(at + 1, close), span: span(close + 1) },
          end: close + 1,
        }
  }
  if (source.startsWith("[[", at) || source.startsWith("#[[", at)) {
    const tagged = char === "#"
    const open = tagged ? at + 1 : at
    const end = pairedEnd(source, open, "[[", "]]")
    const name = end === -1 ? "" : source.slice(open + 2, end - 2).trim()
    if (name === "") return null
    return {
      node: tagged
        ? { _tag: "Tag", name, span: span(end) }
        : { _tag: "PageRef", name, brackets: true, span: span(end) },
      end,
    }
  }
  if (char === "#") {
    const tag = matchAt(TAG_AT, source, at)
    const name = (tag?.[1] ?? "").replace(TAG_TRAILER, "")
    if (name === "") return null
    const end = at + 1 + name.length
    return { node: { _tag: "Tag", name, span: span(end) }, end }
  }
  if (char === "(") {
    const ref = matchAt(BLOCK_REF_AT, source, at)
    if (ref === null) return null
    const end = at + ref[0].length
    return { node: { _tag: "BlockRef", uuid: (ref[1] ?? "").toLowerCase(), span: span(end) }, end }
  }
  if (char === "{") {
    const macro = matchAt(MACRO_AT, source, at)
    if (macro === null) return null
    const end = at + macro[0].length
    return {
      node: {
        _tag: "Macro",
        name: (macro[1] ?? "").toLowerCase(),
        args: (macro[2] ?? "").trim(),
        span: span(end),
      },
      end,
    }
  }
  if (char === "[") {
    const priority = matchAt(PRIORITY_AT, source, at)
    if (priority !== null) {
      const value = priority[1]
      if (value === "A" || value === "B" || value === "C") {
        const end = at + priority[0].length
        return { node: { _tag: "Priority", priority: value, span: span(end) }, end }
      }
    }
  }
  if (char === "[" || (char === "!" && source[at + 1] === "[")) {
    const image = char === "!"
    const labelFrom = image ? at + 1 : at
    const labelEnd = bracketEnd(source, labelFrom)
    if (labelEnd === -1 || source[labelEnd + 1] !== "(") return null
    const targetEnd = parenEnd(source, labelEnd + 1)
    if (targetEnd === -1) return null
    const label = source.slice(labelFrom + 1, labelEnd)
    const target = targetOf(source.slice(labelEnd + 2, targetEnd))
    const end = targetEnd + 1
    if (image) {
      return target._tag === "Url"
        ? { node: { _tag: "Image", alt: label, url: target.url, span: span(end) }, end }
        : null
    }
    return {
      node: {
        _tag: "Link",
        label: parseInline(label, base + labelFrom + 1),
        target,
        span: span(end),
      },
      end,
    }
  }
  if (char === "h" && !isWord(source[at - 1])) {
    const url = matchAt(URL_AT, source, at)?.[0].replace(URL_TRAILER, "")
    if (url === undefined || url.length <= "https://".length) return null
    const end = at + url.length
    return {
      node: {
        _tag: "Link",
        label: [{ _tag: "Text", text: url, span: span(end) }],
        target: { _tag: "Url", url },
        span: span(end),
      },
      end,
    }
  }
  return null
}

const closingAt = (source: string, from: number, delimiter: string): number => {
  for (let at = from; at < source.length; at++) {
    const atom = atomAt(source, at, 0)
    if (atom !== null) {
      at = atom.end - 1
      continue
    }
    if (!source.startsWith(delimiter, at) || isSpace(source[at - 1])) continue
    const after = source[at + delimiter.length]
    if (delimiter.length === 1 && after === delimiter) {
      at++
      continue
    }
    if (delimiter.startsWith("_") && isWord(after)) continue
    return at
  }
  return -1
}

const emphasisAt = (source: string, at: number, base: number): Token | null => {
  for (const [delimiter, tag] of delimiters) {
    if (!source.startsWith(delimiter, at)) continue
    const inner = at + delimiter.length
    if (isSpace(source[inner]) || source.startsWith(delimiter[0] ?? "", inner)) continue
    if (delimiter.startsWith("_") && isWord(source[at - 1])) continue
    const close = closingAt(source, inner, delimiter)
    if (close === -1) continue
    const end = close + delimiter.length
    return {
      node: {
        _tag: tag,
        children: parseInline(source.slice(inner, close), base + inner),
        span: { from: base + at, to: base + end },
      },
      end,
    }
  }
  return null
}

export const parseInline = (source: string, base = 0): ReadonlyArray<Inline> => {
  const nodes: Array<Inline> = []
  let text = 0
  let at = 0
  while (at < source.length) {
    const token = atomAt(source, at, base) ?? emphasisAt(source, at, base)
    if (token === null) {
      at++
      continue
    }
    if (at > text) {
      nodes.push({
        _tag: "Text",
        text: source.slice(text, at),
        span: { from: base + text, to: base + at },
      })
    }
    nodes.push(token.node)
    at = token.end
    text = at
  }
  if (text < source.length) {
    nodes.push({
      _tag: "Text",
      text: source.slice(text),
      span: { from: base + text, to: base + source.length },
    })
  }
  return nodes
}

export const plainText = (nodes: ReadonlyArray<Inline>): string =>
  nodes
    .map((node) =>
      Match.valueTags(node, {
        Text: ({ text }) => text,
        Code: ({ code }) => code,
        PageRef: ({ name, brackets }) => (brackets ? `[[${name}]]` : name),
        Tag: ({ name }) => `#${name}`,
        BlockRef: ({ uuid }) => `((${uuid}))`,
        Macro: ({ name, args }) => `{{${args === "" ? name : `${name} ${args}`}}}`,
        Priority: ({ priority }) => `[#${priority}]`,
        Bold: ({ children }) => plainText(children),
        Italic: ({ children }) => plainText(children),
        Strike: ({ children }) => plainText(children),
        Highlight: ({ children }) => plainText(children),
        Link: ({ label }) => plainText(label),
        Image: ({ alt }) => alt,
      }),
    )
    .join("")
