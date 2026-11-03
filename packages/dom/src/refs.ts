import { analyzeBlock, isHiddenProperty } from "@seqno/syntax"

const withNamespaces = (name: string) => {
  const parts = name.toLowerCase().split("/")
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("/"))
}

export const refsValue = (names: ReadonlyArray<string>) =>
  `[${[...new Set(names)].map((name) => `"${name}"`).join(", ")}]`

const known = new Map<string, ReadonlyArray<string>>()
const cacheLimit = 4000

const read = (text: string) => {
  const syntax = analyzeBlock(text)
  return [
    ...(syntax.marker === null ? [] : [syntax.marker.toLowerCase()]),
    ...(syntax.priority === null ? [] : [syntax.priority.toLowerCase()]),
    ...syntax.refs.flatMap((ref) =>
      ref._tag === "BlockRef" ? [ref.uuid.toLowerCase()] : withNamespaces(ref.name),
    ),
    ...syntax.properties.flatMap((property) =>
      isHiddenProperty(property.key) ? [] : [property.key.toLowerCase()],
    ),
  ]
}

export const refsOf = (text: string): ReadonlyArray<string> => {
  const hit = known.get(text)
  if (hit !== undefined) return hit
  const found = read(text)
  if (known.size >= cacheLimit) {
    const oldest = known.keys().next().value
    if (oldest !== undefined) known.delete(oldest)
  }
  known.set(text, found)
  return found
}

export const refsSelf = (text: string) => refsValue(refsOf(text))
