import type { Inline, MathOpen } from "@seqno/syntax"
import { element, text as textNode } from "./html.ts"
import type { Html } from "./html.ts"
import type { Run } from "./items.ts"

export interface Removals {
  readonly brackets: boolean
  readonly emphasis: boolean
  readonly tags: boolean
}

export interface Inlines {
  readonly removals: Removals
  readonly ref: (uuid: string) => Run | undefined
}

const maxRefDepth = 5

const refOf = (node: Inline): string | null =>
  node._tag === "BlockRef"
    ? node.uuid
    : node._tag === "Link" && node.target._tag === "Block"
      ? node.target.uuid
      : null

const walk = <C, O>(
  run: Run,
  inlines: Inlines,
  depth: number,
  context: C,
  gap: (text: string) => readonly O[],
  node: (
    node: Inline,
    raw: string,
    context: C,
    children: (nodes: readonly Inline[], context: C) => readonly O[],
  ) => readonly O[],
): readonly O[] => {
  const children = (from: number, to: number, nodes: readonly Inline[], inner: C): readonly O[] => {
    const out: O[] = []
    let at = from

    for (const child of nodes) {
      out.push(...gap(run.source.slice(at, child.span.from)))
      const raw = run.source.slice(child.span.from, child.span.to)
      const uuid = refOf(child)
      const target = uuid === null || depth >= maxRefDepth ? undefined : inlines.ref(uuid)
      out.push(
        ...(target === undefined
          ? node(child, raw, inner, (nested, next) =>
              children(
                nested[0]?.span.from ?? child.span.to,
                nested.at(-1)?.span.to ?? child.span.to,
                nested,
                next,
              ),
            )
          : walk(target, inlines, depth + 1, inner, gap, node)),
      )
      at = child.span.to
    }

    out.push(...gap(run.source.slice(at, to)))

    return out
  }

  return children(run.from, run.to, run.nodes, context)
}

const emphasisOf = (node: Inline) =>
  node._tag === "Bold" ||
  node._tag === "Italic" ||
  node._tag === "Strike" ||
  node._tag === "Underline" ||
  node._tag === "Highlight"
    ? node
    : null

const AUTOLINK = /<(https?:\/\/[^\s>]+)>/gu

const CLOZE = /^\s*(.*?)\s*$/su

const SPACE = "\uE000"
const SPACES = /\uE000+/gu
const WHITESPACE = /\s/u

const spaced = (text: string) =>
  text.replaceAll(SPACES, (marks: string, at: number) => {
    const before = text[at - 1]
    const after = text[at + marks.length]

    return before === undefined ||
      after === undefined ||
      WHITESPACE.test(before) ||
      WHITESPACE.test(after)
      ? ""
      : " "
  })

const wrapperOf = (open: MathOpen) => (open === "$" || open === "\\(" ? "$" : "$$")

export const mathText = (open: MathOpen, tex: string) =>
  `${wrapperOf(open)}${tex}${wrapperOf(open)}`

export const markdownOf = (run: Run, inlines: Inlines, depth = 0): string =>
  spaced(
    walk<boolean, string>(
      run,
      inlines,
      depth,
      false,
      (text) => [text],
      (node, raw, starred, nested) => [markdownNode(node, raw, starred, nested, inlines)],
    ).join(""),
  ).replaceAll(AUTOLINK, "$1")

const markdownNode = (
  node: Inline,
  raw: string,
  starred: boolean,
  nested: (nodes: readonly Inline[], context: boolean) => readonly string[],
  inlines: Inlines,
): string => {
  const children = (nodes: readonly Inline[], next: boolean) => nested(nodes, next).join("")
  const emphasis = emphasisOf(node)

  if (emphasis !== null) {
    if (inlines.removals.emphasis) {
      return children(emphasis.children, starred)
    }

    switch (emphasis._tag) {
      case "Bold": {
        return starred
          ? `__${children(emphasis.children, true)}__`
          : `**${children(emphasis.children, true)}**`
      }

      case "Italic": {
        return starred
          ? `_${children(emphasis.children, true)}_`
          : `*${children(emphasis.children, true)}*`
      }

      case "Strike": {
        return `~~${children(emphasis.children, starred)}~~`
      }

      case "Highlight": {
        return `^^${children(emphasis.children, starred)}^^`
      }

      case "Underline": {
        return children(emphasis.children, starred)
      }
    }
  }

  if (node._tag === "Math") {
    return `${SPACE}${mathText(node.open, node.tex)}${SPACE}`
  }

  if (node._tag === "PageRef" && node.brackets && inlines.removals.brackets) {
    return node.name
  }

  if (node._tag === "Tag" && inlines.removals.tags) {
    return ""
  }

  if (
    node._tag === "Link" &&
    node.target._tag === "Url" &&
    raw.startsWith("<") &&
    raw.endsWith(">")
  ) {
    return node.target.url
  }

  if (node._tag === "Macro" && node.name === "cloze") {
    return CLOZE.exec(node.args)?.[1] ?? ""
  }

  return raw
}

export const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const tagOf = {
  Bold: "b",
  Italic: "i",
  Strike: "del",
  Underline: "ins",
  Highlight: "mark",
} as const

const FOOTNOTE = /\[\^([^\]\s]+)\]/gu

const plain = (value: string): readonly Html[] => {
  const out: Html[] = []
  let at = 0

  for (const match of value.matchAll(FOOTNOTE)) {
    if (match.index > at) {
      out.push(textNode(value.slice(at, match.index)))
    }

    const [whole, note = ""] = match
    out.push(element("sup", [element("a", [textNode(note)], [["href", `#fnd.${note}`]])]))
    at = match.index + whole.length
  }

  if (at < value.length) {
    out.push(textNode(value.slice(at)))
  }

  return out
}

export const htmlOf = (run: Run, inlines: Inlines, depth = 0): readonly Html[] =>
  walk<null, Html>(run, inlines, depth, null, plain, (node, raw, context, nested) => {
    const children = (nodes: readonly Inline[]) => nested(nodes, context)

    switch (node._tag) {
      case "Text": {
        return plain(raw)
      }

      case "Code": {
        return [element("code", [textNode(node.code)])]
      }

      case "Math": {
        return [element("span", [textNode(mathText(node.open, node.tex))])]
      }

      case "PageRef": {
        return inlines.removals.brackets || !node.brackets
          ? [textNode(node.name)]
          : [element("a", [textNode(raw)])]
      }

      case "Tag": {
        return inlines.removals.tags ? [] : [element("a", [textNode(raw)])]
      }

      case "BlockRef": {
        return [element("a", [textNode(raw)])]
      }

      case "Macro": {
        return [
          element("code", [
            textNode(node.name === "cloze" ? (CLOZE.exec(node.args)?.[1] ?? "") : raw),
          ]),
        ]
      }

      case "Priority": {
        return [textNode(raw)]
      }

      case "Bold":
      case "Italic":
      case "Strike":
      case "Underline":
      case "Highlight": {
        return inlines.removals.emphasis
          ? children(node.children)
          : [element(tagOf[node._tag], children(node.children))]
      }

      case "Link": {
        return node.target._tag === "Url"
          ? [element("a", children(node.label), [["href", node.target.url]])]
          : [element("a", [textNode(raw)])]
      }

      case "Image": {
        return [element("a", [textNode(node.alt)], [["href", node.url]])]
      }
    }
  })
