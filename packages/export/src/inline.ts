import type { Inline } from "@seqno/syntax"
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

const walk = <C>(
  run: Run,
  inlines: Inlines,
  depth: number,
  context: C,
  gap: (text: string) => string,
  node: (
    node: Inline,
    raw: string,
    context: C,
    children: (nodes: ReadonlyArray<Inline>, context: C) => string,
  ) => string,
): string => {
  const children = (from: number, to: number, nodes: ReadonlyArray<Inline>, inner: C): string => {
    let out = ""
    let at = from
    for (const child of nodes) {
      out += gap(run.source.slice(at, child.span.from))
      const raw = run.source.slice(child.span.from, child.span.to)
      const uuid = refOf(child)
      const target = uuid === null || depth >= maxRefDepth ? undefined : inlines.ref(uuid)
      out +=
        target === undefined
          ? node(child, raw, inner, (nested, next) =>
              children(
                nested[0]?.span.from ?? child.span.to,
                nested.at(-1)?.span.to ?? child.span.to,
                nested,
                next,
              ),
            )
          : walk(target, inlines, depth + 1, inner, gap, node)
      at = child.span.to
    }
    return out + gap(run.source.slice(at, to))
  }
  return children(run.from, run.to, run.nodes, context)
}

const emphasisOf = (node: Inline) =>
  node._tag === "Bold" ||
  node._tag === "Italic" ||
  node._tag === "Strike" ||
  node._tag === "Highlight"
    ? node
    : null

const CLOZE = /^\s*(.*?)\s*$/s

export const markdownOf = (run: Run, inlines: Inlines, depth = 0): string =>
  walk(
    run,
    inlines,
    depth,
    false,
    (text) => text,
    (node, raw, starred, children) => {
      const emphasis = emphasisOf(node)
      if (emphasis !== null) {
        if (inlines.removals.emphasis) return children(emphasis.children, starred)
        switch (emphasis._tag) {
          case "Bold":
            return starred
              ? `__${children(emphasis.children, true)}__`
              : `**${children(emphasis.children, true)}**`
          case "Italic":
            return starred
              ? `_${children(emphasis.children, true)}_`
              : `*${children(emphasis.children, true)}*`
          case "Strike":
            return `~~${children(emphasis.children, starred)}~~`
          case "Highlight":
            return `^^${children(emphasis.children, starred)}^^`
        }
      }
      if (node._tag === "PageRef" && node.brackets && inlines.removals.brackets) return node.name
      if (node._tag === "Tag" && inlines.removals.tags) return ""
      if (node._tag === "Macro" && node.name === "cloze") return CLOZE.exec(node.args)?.[1] ?? ""
      return raw
    },
  )

export const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const tagOf = { Bold: "b", Italic: "i", Strike: "del", Highlight: "mark" } as const

export const htmlOf = (run: Run, inlines: Inlines, depth = 0): string =>
  walk(run, inlines, depth, null, escapeHtml, (node, raw, context, nested) => {
    const children = (nodes: ReadonlyArray<Inline>) => nested(nodes, context)
    switch (node._tag) {
      case "Text":
        return escapeHtml(raw)
      case "Code":
        return `<code>${escapeHtml(node.code)}</code>`
      case "PageRef":
        return inlines.removals.brackets || !node.brackets
          ? escapeHtml(node.name)
          : `<a>${escapeHtml(raw)}</a>`
      case "Tag":
        return inlines.removals.tags ? "" : `<a>${escapeHtml(raw)}</a>`
      case "BlockRef":
        return `<a>${escapeHtml(raw)}</a>`
      case "Macro":
        return node.name === "cloze"
          ? `<code>${escapeHtml(CLOZE.exec(node.args)?.[1] ?? "")}</code>`
          : `<code>${escapeHtml(raw)}</code>`
      case "Priority":
        return escapeHtml(raw)
      case "Bold":
      case "Italic":
      case "Strike":
      case "Highlight": {
        const inner = children(node.children)
        return inlines.removals.emphasis
          ? inner
          : `<${tagOf[node._tag]}>${inner}</${tagOf[node._tag]}>`
      }
      case "Link":
        return node.target._tag === "Url"
          ? `<a href="${escapeHtml(node.target.url)}">${children(node.label)}</a>`
          : `<a>${escapeHtml(raw)}</a>`
      case "Image":
        return `<a href="${escapeHtml(node.url)}">${escapeHtml(node.alt)}</a>`
    }
  })
