export type Facet =
  | "exist"
  | "tree"
  | "move"
  | "text"
  | "created"
  | "updated"
  | "ref"
  | "tag"
  | "property"
  | "task.status"
  | "task.priority"
  | "task.scheduled"
  | "task.deadline"
  | "page.name"
  | "page.alias"
  | "page.tag"
  | "page.namespace"
  | "page.property"

type KeyedFacet = "ref" | "tag" | "property" | "page.tag" | "page.namespace" | "page.property"

export type ReadKey = Facet | `${KeyedFacet}:${string}`

export const REBUILT = "rebuilt"

export type Changes = Map<Facet, Set<string>>

export const touch = (changes: Changes, facet: Facet, ids: Iterable<string> = []): void => {
  const set = changes.get(facet) ?? new Set<string>()
  for (const id of ids) set.add(id)
  changes.set(facet, set)
}

export const toInvalidation = (changes: Changes): Record<string, ReadonlyArray<string>> =>
  Object.fromEntries([...changes].map(([facet, ids]) => [facet, [...ids]]))
