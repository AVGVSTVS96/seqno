import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import { Tag, styleTags, tags } from "@lezer/highlight"
import type { InlineContext, InlineParser, MarkdownConfig } from "@lezer/markdown"

const code = (char: string): number => char.charCodeAt(0)

const tagBody = /^[^\s,.!?;:"'()[\]{}#]+/

const isBoundary = (char: number): boolean => char === -1 || /\s/.test(String.fromCharCode(char))

const enclosed = (node: string, open: string, close: string): InlineParser => ({
  name: `${node} ${open}`,
  before: "Link",
  parse: (cx: InlineContext, next: number, pos: number) => {
    if (next !== code(open) || cx.slice(pos, pos + open.length) !== open) {
      return -1
    }
    if (open.startsWith("#") && !isBoundary(cx.char(pos - 1))) {
      return -1
    }
    const start = pos + open.length
    const length = (cx.slice(start, cx.end).split("\n")[0] ?? "").indexOf(close)
    if (length <= 0) {
      return -1
    }
    const closeAt = start + length
    return cx.addElement(
      cx.elt(node, pos, closeAt + close.length, [
        cx.elt(`${node}Mark`, pos, start),
        cx.elt(`${node}Mark`, closeAt, closeAt + close.length),
      ]),
    )
  },
})

const hashTag: InlineParser = {
  name: "Tag #",
  before: "Link",
  parse: (cx, next, pos) => {
    if (next !== code("#") || !isBoundary(cx.char(pos - 1))) {
      return -1
    }
    const body = tagBody.exec(cx.slice(pos + 1, cx.end))
    if (body === null) {
      return -1
    }
    return cx.addElement(
      cx.elt("Tag", pos, pos + 1 + body[0].length, [cx.elt("TagMark", pos, pos + 1)]),
    )
  },
}

export const seqnoTags = {
  pageRef: Tag.define(tags.link),
  blockRef: Tag.define(tags.link),
  tag: Tag.define(tags.link),
}

const logseqInline: MarkdownConfig = {
  defineNodes: ["PageRef", "PageRefMark", "BlockRef", "BlockRefMark", "Tag", "TagMark"],
  parseInline: [
    enclosed("PageRef", "[[", "]]"),
    enclosed("BlockRef", "((", "))"),
    enclosed("Tag", "#[[", "]]"),
    hashTag,
  ],
  props: [
    styleTags({
      "PageRef/...": seqnoTags.pageRef,
      "BlockRef/...": seqnoTags.blockRef,
      "Tag/...": seqnoTags.tag,
      "PageRefMark BlockRefMark TagMark": tags.processingInstruction,
    }),
  ],
}

const liveStyles = HighlightStyle.define([
  { tag: tags.processingInstruction, class: "sq-mark" },
  { tag: tags.strong, class: "sq-strong" },
  { tag: tags.emphasis, class: "sq-emphasis" },
  { tag: tags.strikethrough, class: "sq-strike" },
  { tag: tags.monospace, class: "sq-code" },
  { tag: tags.heading, class: "sq-heading" },
  { tag: [tags.link, tags.url], class: "sq-link" },
  { tag: seqnoTags.pageRef, class: "sq-page-ref" },
  { tag: seqnoTags.blockRef, class: "sq-block-ref" },
  { tag: seqnoTags.tag, class: "sq-tag" },
  { tag: tags.quote, class: "sq-quote" },
])

const liveTheme = EditorView.baseTheme({
  ".sq-mark": { opacity: "0.45" },
  ".sq-strong": { fontWeight: "700" },
  ".sq-emphasis": { fontStyle: "italic" },
  ".sq-strike": { textDecoration: "line-through" },
  ".sq-code": { fontFamily: "ui-monospace, monospace", fontSize: "0.92em" },
  ".sq-heading": { fontWeight: "700", fontSize: "1.2em" },
  ".sq-link, .sq-page-ref, .sq-tag": { color: "var(--sq-link, #2563eb)" },
  ".sq-block-ref": { borderBottom: "1px solid var(--sq-link, #2563eb)" },
  ".sq-quote": { fontStyle: "italic" },
})

export const liveMarkdown = [
  markdown({ base: markdownLanguage, extensions: logseqInline, addKeymap: false }),
  syntaxHighlighting(liveStyles),
  liveTheme,
]
