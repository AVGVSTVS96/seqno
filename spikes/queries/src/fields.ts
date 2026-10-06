import type { Parsed } from "./markdown.ts"
import type { Field } from "./model.ts"

export type FieldType = "name" | "string" | "date" | "time" | "bool" | "any" | "id"
export type Owner = "block" | "page"
export type Primitive = string | number | boolean

export interface PageFacets {
  readonly rid: number
  readonly name: string
  readonly day: number | null
  readonly tags: ReadonlyArray<string>
  readonly aliases: ReadonlyArray<string>
  readonly namespaces: ReadonlyArray<string>
  readonly props: ReadonlyArray<readonly [string, string]>
}

export interface BlockFacets {
  readonly id: string
  readonly content: string
  readonly parsed: Parsed
  readonly created: number
  readonly updated: number
  readonly page: PageFacets
}

export type Storage =
  | { readonly kind: "column"; readonly expr: (alias: string) => string }
  | {
      readonly kind: "table"
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

const task = (col: "status" | "priority" | "scheduled" | "deadline", type: FieldType): FieldDef => ({
  owner: "block",
  type,
  storage: { kind: "table", table: "tasks", col, many: false },
  key: `task.${col}`,
  keyed: false,
  values: (f) => opt(f.parsed.task?.[col]),
})

const FIXED: Record<string, FieldDef> = {
  id: { owner: "block", type: "id", storage: { kind: "column", expr: (t) => `${t}.id` }, key: "exist", keyed: false, values: (f) => [f.id] },
  created: { owner: "block", type: "time", storage: { kind: "column", expr: (t) => `${t}.created` }, key: "created", keyed: false, values: (f) => [f.created] },
  updated: { owner: "block", type: "time", storage: { kind: "column", expr: (t) => `${t}.updated` }, key: "updated", keyed: false, values: (f) => [f.updated] },
  ref: {
    owner: "block",
    type: "name",
    storage: { kind: "table", table: "refs", col: "target", many: true },
    key: "ref",
    keyed: true,
    values: (f) => f.parsed.refs,
  },
  tag: {
    owner: "block",
    type: "name",
    storage: { kind: "table", table: "refs", col: "target", cond: (t) => `${t}.tag = 1`, many: true },
    key: "tag",
    keyed: true,
    values: (f) => f.parsed.tags,
  },
  "task.status": task("status", "string"),
  "task.priority": task("priority", "string"),
  "task.scheduled": task("scheduled", "date"),
  "task.deadline": task("deadline", "date"),
  page: { owner: "page", type: "name", storage: { kind: "column", expr: (t) => `${t}.name_lc` }, key: "page.name", keyed: false, values: (f) => [f.page.name] },
  "page.journal": {
    owner: "page",
    type: "bool",
    storage: { kind: "column", expr: (t) => `(${t}.day IS NOT NULL)` },
    key: "page.name",
    keyed: false,
    values: (f) => [f.page.day !== null],
  },
  "page.day": { owner: "page", type: "date", storage: { kind: "column", expr: (t) => `${t}.day` }, key: "page.name", keyed: false, values: (f) => opt(f.page.day) },
  "page.tag": {
    owner: "page",
    type: "name",
    storage: { kind: "table", table: "page_tags", col: "tag", many: true },
    key: "page.tag",
    keyed: true,
    values: (f) => f.page.tags,
  },
  "page.alias": {
    owner: "page",
    type: "string",
    storage: { kind: "table", table: "page_names", col: "name", cond: (t) => `${t}.alias = 1`, many: true },
    key: "page.alias",
    keyed: false,
    values: (f) => f.page.aliases,
  },
  "page.namespace": {
    owner: "page",
    type: "string",
    storage: { kind: "table", table: "page_ns", col: "ns", many: true },
    key: "page.namespace",
    keyed: true,
    values: (f) => f.page.namespaces,
  },
}

const property = (owner: Owner, key: string): FieldDef => ({
  owner,
  type: "any",
  storage: { kind: "table", table: owner === "block" ? "props" : "page_props", col: "value", num: "num", cond: (t) => `${t}.key = ${quote(key)}`, many: true },
  key: owner === "block" ? `property:${key}` : `page.property:${key}`,
  keyed: false,
  values: (f) => (owner === "block" ? f.parsed.props : f.page.props).flatMap(([k, v]) => (k === key ? [v] : [])),
})

export const fieldDef = (field: Field): FieldDef =>
  FIXED[field] ??
  (field.startsWith("page.property.")
    ? property("page", field.slice("page.property.".length))
    : field.startsWith("property.")
      ? property("block", field.slice("property.".length))
      : (() => {
          throw new Error(`field ${field} has no storage`)
        })())
