import { isFixedField, type Field, type FixedField } from "./ast.ts"
import { fail } from "./error.ts"
import type { BlockFacets, TaskFacets } from "./facets.ts"

export type FieldType = "name" | "string" | "date" | "time" | "bool" | "any" | "id"
export type Owner = "block" | "page"
export type Primitive = string | number | boolean

export type Storage =
  | { readonly _tag: "Column"; readonly expr: (alias: string) => string }
  | {
      readonly _tag: "Table"
      readonly table: string
      readonly col: string
      readonly cond?: (alias: string) => string
      readonly num?: string
      readonly many: boolean
    }

export interface FieldDef {
  readonly owner: Owner
  readonly type: FieldType
  readonly storage: Storage
  readonly key: string
  readonly keyed: boolean
  readonly values: (f: BlockFacets) => ReadonlyArray<Primitive>
}

const opt = <A>(a: A | null | undefined): ReadonlyArray<A> => (a == null ? [] : [a])
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`
const column = (expr: (alias: string) => string): Storage => ({ _tag: "Column", expr })

const task = (col: keyof TaskFacets, type: FieldType): FieldDef => ({
  owner: "block",
  type,
  storage: { _tag: "Table", table: "tasks", col, many: false },
  key: `task.${col}`,
  keyed: false,
  values: (f) => opt(f.task?.[col]),
})

const FIXED: Record<FixedField, FieldDef> = {
  id: { owner: "block", type: "id", storage: column((t) => `${t}.id`), key: "exist", keyed: false, values: (f) => [f.id] },
  created: { owner: "block", type: "time", storage: column((t) => `${t}.created`), key: "created", keyed: false, values: (f) => [f.created] },
  updated: { owner: "block", type: "time", storage: column((t) => `${t}.updated`), key: "updated", keyed: false, values: (f) => [f.updated] },
  ref: {
    owner: "block",
    type: "name",
    storage: { _tag: "Table", table: "refs", col: "target", many: true },
    key: "ref",
    keyed: true,
    values: (f) => f.refs,
  },
  tag: {
    owner: "block",
    type: "name",
    storage: { _tag: "Table", table: "refs", col: "target", cond: (t) => `${t}.tag = 1`, many: true },
    key: "tag",
    keyed: true,
    values: (f) => f.tags,
  },
  "task.status": task("status", "string"),
  "task.priority": task("priority", "string"),
  "task.scheduled": task("scheduled", "date"),
  "task.deadline": task("deadline", "date"),
  page: { owner: "page", type: "name", storage: column((t) => `${t}.name_lc`), key: "page.name", keyed: false, values: (f) => [f.page.name] },
  "page.journal": {
    owner: "page",
    type: "bool",
    storage: column((t) => `(${t}.day IS NOT NULL)`),
    key: "page.name",
    keyed: false,
    values: (f) => [f.page.day !== null],
  },
  "page.day": { owner: "page", type: "date", storage: column((t) => `${t}.day`), key: "page.name", keyed: false, values: (f) => opt(f.page.day) },
  "page.tag": {
    owner: "page",
    type: "name",
    storage: { _tag: "Table", table: "page_tags", col: "tag", many: true },
    key: "page.tag",
    keyed: true,
    values: (f) => f.page.tags,
  },
  "page.alias": {
    owner: "page",
    type: "string",
    storage: { _tag: "Table", table: "page_names", col: "name", cond: (t) => `${t}.alias = 1`, many: true },
    key: "page.alias",
    keyed: false,
    values: (f) => f.page.aliases,
  },
  "page.namespace": {
    owner: "page",
    type: "string",
    storage: { _tag: "Table", table: "page_ns", col: "ns", many: true },
    key: "page.namespace",
    keyed: true,
    values: (f) => f.page.namespaces,
  },
}

const property = (owner: Owner, key: string): FieldDef => ({
  owner,
  type: "any",
  storage: {
    _tag: "Table",
    table: owner === "block" ? "props" : "page_props",
    col: "value",
    num: "num",
    cond: (t) => `${t}.key = ${quote(key)}`,
    many: true,
  },
  key: owner === "block" ? `property:${key}` : `page.property:${key}`,
  keyed: false,
  values: (f) => (owner === "block" ? f.props : f.page.props).flatMap(([k, v]) => (k === key ? [v] : [])),
})

const PROPERTY = /^(page\.)?property\.(.+)$/

export const fieldDef = (field: Field): FieldDef => {
  if (isFixedField(field)) return FIXED[field]
  const [, page, key] = PROPERTY.exec(field) ?? []
  return key === undefined ? fail(`field ${field} has no storage`) : property(page === undefined ? "block" : "page", key)
}
