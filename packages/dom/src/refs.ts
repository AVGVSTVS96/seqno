import { analyzeBlock, isHiddenProperty } from "@seqno/syntax"

const withNamespaces = (name: string) => {
  const parts = name.toLowerCase().split("/")
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("/"))
}

const dataValue = (names: ReadonlyArray<string>) =>
  `[${[...new Set(names)].map((name) => `"${name}"`).join(", ")}]`

const known = new Map<string, string>()
const cacheLimit = 4000

const refsOf = (text: string) => {
  const syntax = analyzeBlock(text)
  return dataValue([
    ...(syntax.marker === null ? [] : [syntax.marker.toLowerCase()]),
    ...(syntax.priority === null ? [] : [syntax.priority.toLowerCase()]),
    ...syntax.refs.flatMap((ref) =>
      ref._tag === "BlockRef" ? [ref.uuid.toLowerCase()] : withNamespaces(ref.name),
    ),
    ...syntax.properties.flatMap((property) =>
      isHiddenProperty(property.key) ? [] : [property.key.toLowerCase()],
    ),
  ])
}

export const refsSelf = (text: string) => {
  const hit = known.get(text)
  if (hit !== undefined) return hit
  const value = refsOf(text)
  if (known.size >= cacheLimit) {
    const oldest = known.keys().next().value
    if (oldest !== undefined) known.delete(oldest)
  }
  known.set(text, value)
  return value
}
