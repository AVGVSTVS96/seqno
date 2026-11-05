import { Match } from "effect"
import { defaultPropertyConfig, parseInline } from "@seqno/syntax"
import type { Inline, PropertyConfig } from "@seqno/syntax"

export type PropertyValue = string | number | boolean | readonly string[]

export const isList = (value: PropertyValue): value is readonly string[] =>
  typeof value === "object"

const linkable = new Set(["alias", "aliases", "tags"])

const unparsed = new Set([
  "id",
  "custom-id",
  "background-color",
  "background_color",
  "query-properties",
  "query-sort-by",
  "ls-type",
  "hl-type",
  "hl-color",
  "logseq.macro-name",
  "logseq.macro-arguments",
  "logseq.order-list-type",
  "logseq.tldraw.page",
  "logseq.tldraw.shape",
  "title",
  "icon",
  "template",
  "filters",
  "macro",
  "filetags",
  "logseq.color",
  "logseq.table.version",
  "logseq.table.compact",
  "logseq.table.headers",
  "logseq.table.hover",
  "logseq.table.borders",
  "logseq.table.stripes",
  "logseq.table.max-width",
])

const refOf = (node: Inline): string | null =>
  Match.value(node).pipe(
    Match.tag("PageRef", "Tag", ({ name }) => name.trim()),
    Match.tag("Link", ({ target }) => (target._tag === "Page" ? target.name.trim() : null)),
    Match.orElse(() => null),
  )

const refsOf = (
  key: string,
  nodes: readonly Inline[],
  config: PropertyConfig,
): readonly string[] => {
  const refs = nodes.flatMap((node) => {
    const ref = refOf(node)

    return ref === null ? [] : [ref]
  })

  const plains =
    linkable.has(key) || config.listKeys.has(key)
      ? nodes.flatMap((node) =>
          node._tag === "Text"
            ? node.text
                .split(/[,，]/u)
                .map((part) => part.trim())
                .filter((part) => part !== "")
            : [],
        )
      : []

  return [...new Set([...refs, ...plains])]
}

export const propertyValue = (
  key: string,
  raw: string,
  config: PropertyConfig = defaultPropertyConfig,
): PropertyValue => {
  const value = raw.trim()
  const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"')

  if (unparsed.has(key) || config.unparsedKeys.has(key) || quoted) {
    return value
  }

  const refs = refsOf(key, parseInline(value), config)

  if (refs.length > 0) {
    return refs
  }

  if (value === "true") {
    return true
  }

  if (value === "false") {
    return false
  }

  return /^\d+$/u.test(value) ? Number(value) : value
}
