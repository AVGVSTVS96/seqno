const FACETS = [
  "exist",
  "tree",
  "move",
  "text",
  "created",
  "updated",
  "ref",
  "tag",
  "property",
  "task.status",
  "task.priority",
  "task.scheduled",
  "task.deadline",
  "page.name",
  "page.alias",
  "page.tag",
  "page.namespace",
  "page.property",
] as const

const KEYED_FACETS = [
  "ref",
  "tag",
  "property",
  "page.tag",
  "page.namespace",
  "page.property",
] as const

export type Facet = (typeof FACETS)[number]

type KeyedFacet = (typeof KEYED_FACETS)[number]

export type ReadKey = Facet | `${KeyedFacet}:${string}`

const facets: ReadonlySet<string> = new Set(FACETS)
const keyedFacets: ReadonlySet<string> = new Set(KEYED_FACETS)

export const isReadKey = (key: string): key is ReadKey => {
  const colon = key.indexOf(":")
  return colon === -1 ? facets.has(key) : keyedFacets.has(key.slice(0, colon))
}

export const REBUILT = "rebuilt"

export type Changes = Map<Facet, Set<string>>

export const touch = (changes: Changes, facet: Facet, ids: Iterable<string> = []): void => {
  const set = changes.get(facet) ?? new Set<string>()
  for (const id of ids) set.add(id)
  changes.set(facet, set)
}

export const toInvalidation = (changes: Changes): Record<string, ReadonlyArray<string>> =>
  Object.fromEntries([...changes].map(([facet, ids]) => [facet, [...ids]]))
