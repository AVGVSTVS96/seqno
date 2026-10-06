import { Schema } from "effect"
import { BlockId } from "@seqno/domain"

export type Inline =
  | { readonly _tag: "Text"; readonly text: string }
  | { readonly _tag: "Code"; readonly code: string }
  | { readonly _tag: "PageRef"; readonly name: string }
  | { readonly _tag: "Tag"; readonly name: string }
  | { readonly _tag: "BlockRef"; readonly blockId: BlockId }
  | { readonly _tag: "Bold"; readonly children: ReadonlyArray<Inline> }
  | { readonly _tag: "Italic"; readonly children: ReadonlyArray<Inline> }
  | { readonly _tag: "Strike"; readonly children: ReadonlyArray<Inline> }
  | { readonly _tag: "Highlight"; readonly children: ReadonlyArray<Inline> }
  | { readonly _tag: "Link"; readonly label: ReadonlyArray<Inline>; readonly href: string }

export const TaskMarker = Schema.Literals([
  "TODO",
  "DOING",
  "DONE",
  "LATER",
  "NOW",
  "WAITING",
  "CANCELED",
])
export type TaskMarker = typeof TaskMarker.Type

export type Line =
  | {
      readonly _tag: "Paragraph"
      readonly heading: number
      readonly marker: TaskMarker | null
      readonly inline: ReadonlyArray<Inline>
    }
  | { readonly _tag: "Property"; readonly key: string; readonly value: ReadonlyArray<Inline> }
  | { readonly _tag: "Planning"; readonly kind: "SCHEDULED" | "DEADLINE"; readonly date: string }
  | { readonly _tag: "CodeBlock"; readonly language: string; readonly code: string }

const inlinePattern =
  /`([^`]+)`|#\[\[([^\]]+)\]\]|\[\[([^\]]+)\]\]|\(\(([^)]+)\)\)|(?<![^\s(])#([^\s#,.;:!?()[\]{}"']+)|\*\*(.+?)\*\*|~~(.+?)~~|==(.+?)==|(?<![\w*])\*(?![\s*])(.+?)\*(?!\w)|(?<![\w_])_(?![\s_])(.+?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+)/g

const isBlockId = Schema.is(BlockId)

const token = (match: RegExpMatchArray): Inline => {
  const [
    whole,
    code,
    bracketTag,
    page,
    ref,
    tag,
    bold,
    strike,
    mark,
    star,
    under,
    label,
    href,
    url,
  ] = match
  if (code !== undefined) return { _tag: "Code", code }
  if (bracketTag !== undefined) return { _tag: "Tag", name: bracketTag }
  if (page !== undefined) return { _tag: "PageRef", name: page }
  if (ref !== undefined) return isBlockId(ref) ? { _tag: "BlockRef", blockId: ref } : text(whole)
  if (tag !== undefined) return { _tag: "Tag", name: tag }
  if (bold !== undefined) return { _tag: "Bold", children: parseInline(bold) }
  if (strike !== undefined) return { _tag: "Strike", children: parseInline(strike) }
  if (mark !== undefined) return { _tag: "Highlight", children: parseInline(mark) }
  if (star !== undefined) return { _tag: "Italic", children: parseInline(star) }
  if (under !== undefined) return { _tag: "Italic", children: parseInline(under) }
  if (label !== undefined && href !== undefined) {
    return { _tag: "Link", label: parseInline(label), href }
  }
  if (url !== undefined) return { _tag: "Link", label: [text(url)], href: url }
  return text(whole)
}

const text = (value: string): Inline => ({ _tag: "Text", text: value })

export const parseInline = (source: string): ReadonlyArray<Inline> => {
  const out: Array<Inline> = []
  let at = 0
  for (const match of source.matchAll(inlinePattern)) {
    if (match.index > at) out.push(text(source.slice(at, match.index)))
    out.push(token(match))
    at = match.index + match[0].length
  }
  if (at < source.length) out.push(text(source.slice(at)))
  return out
}

const propertyLine = /^\s*([A-Za-z0-9_-]+)::\s?(.*)$/
const planningLine = /^\s*(SCHEDULED|DEADLINE):\s*<([^>]+)>\s*$/
const headingAndMarker = /^(#{1,6}\s+)?(?:(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELED)\s+)?/
const fence = /^\s*```(.*)$/

const isMarker = Schema.is(TaskMarker)

export const parseBlock = (source: string): ReadonlyArray<Line> => {
  const lines: Array<Line> = []
  const raw = source.split("\n")
  for (let index = 0; index < raw.length; index++) {
    const line = raw[index] ?? ""
    const opening = fence.exec(line)
    if (opening !== null) {
      const end = raw.findIndex((candidate, at) => at > index && fence.test(candidate))
      const close = end === -1 ? raw.length : end
      lines.push({
        _tag: "CodeBlock",
        language: (opening[1] ?? "").trim(),
        code: raw.slice(index + 1, close).join("\n"),
      })
      index = close
      continue
    }
    const property = propertyLine.exec(line)
    if (property !== null) {
      lines.push({
        _tag: "Property",
        key: property[1] ?? "",
        value: parseInline(property[2] ?? ""),
      })
      continue
    }
    const planning = planningLine.exec(line)
    if (planning !== null) {
      lines.push({
        _tag: "Planning",
        kind: planning[1] === "DEADLINE" ? "DEADLINE" : "SCHEDULED",
        date: planning[2] ?? "",
      })
      continue
    }
    const head = index === 0 ? headingAndMarker.exec(line) : null
    const marker = head?.[2]
    lines.push({
      _tag: "Paragraph",
      heading: head?.[1]?.trim().length ?? 0,
      marker: isMarker(marker) ? marker : null,
      inline: parseInline(line.slice(head?.[0].length ?? 0)),
    })
  }
  return lines
}
