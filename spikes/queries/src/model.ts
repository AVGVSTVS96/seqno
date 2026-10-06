import { Schema } from "effect"

export const FIELD_PATTERN =
  /^(id|ref|tag|created|updated|task\.(status|priority|scheduled|deadline)|property\.[a-z0-9_-]+|page|page\.(journal|day|tag|alias|namespace)|page\.property\.[a-z0-9_-]+)$/

export const Field = Schema.String.pipe(Schema.check(Schema.isPattern(FIELD_PATTERN)))
export type Field = typeof Field.Type

export const RelDate = Schema.TaggedStruct("RelDate", { amount: Schema.Int, unit: Schema.Literals(["d", "w", "m", "y"]) })
export const AbsDate = Schema.TaggedStruct("AbsDate", { ymd: Schema.Int })
export const Context = Schema.TaggedStruct("Context", { of: Schema.Literals(["page", "block"]) })

export const Value = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, RelDate, AbsDate, Context])
export type Value = typeof Value.Type

export const CompareOp = Schema.Literals(["=", "!=", "<", "<=", ">", ">="])
export type CompareOp = typeof CompareOp.Type

export type Filter =
  | { readonly _tag: "And"; readonly all: ReadonlyArray<Filter> }
  | { readonly _tag: "Or"; readonly any: ReadonlyArray<Filter> }
  | { readonly _tag: "Not"; readonly filter: Filter }
  | { readonly _tag: "Compare"; readonly field: Field; readonly op: CompareOp; readonly value: Value }
  | { readonly _tag: "In"; readonly field: Field; readonly values: ReadonlyArray<Value> }
  | { readonly _tag: "Between"; readonly field: Field; readonly from: Value; readonly to: Value }
  | { readonly _tag: "Has"; readonly field: Field }
  | { readonly _tag: "Search"; readonly text: string }
  | { readonly _tag: "Under"; readonly ancestor: Filter; readonly self: boolean; readonly direct: boolean }
  | { readonly _tag: "HasBlock"; readonly filter: Filter }

const FilterRef = Schema.suspend((): Schema.Codec<Filter> => Filter)

export const Filter: Schema.Codec<Filter> = Schema.Union([
  Schema.TaggedStruct("And", { all: Schema.Array(FilterRef) }),
  Schema.TaggedStruct("Or", { any: Schema.Array(FilterRef) }),
  Schema.TaggedStruct("Not", { filter: FilterRef }),
  Schema.TaggedStruct("Compare", { field: Field, op: CompareOp, value: Value }),
  Schema.TaggedStruct("In", { field: Field, values: Schema.Array(Value) }),
  Schema.TaggedStruct("Between", { field: Field, from: Value, to: Value }),
  Schema.TaggedStruct("Has", { field: Field }),
  Schema.TaggedStruct("Search", { text: Schema.String }),
  Schema.TaggedStruct("Under", { ancestor: FilterRef, self: Schema.Boolean, direct: Schema.Boolean }),
  Schema.TaggedStruct("HasBlock", { filter: FilterRef }),
])

export const Sort = Schema.Struct({ field: Field, dir: Schema.Literals(["asc", "desc"]) })
export type Sort = typeof Sort.Type

export const View = Schema.Union([
  Schema.TaggedStruct("List", {}),
  Schema.TaggedStruct("Table", { columns: Schema.Array(Field) }),
  Schema.TaggedStruct("Board", { by: Field }),
])
export type View = typeof View.Type

export const Query = Schema.Struct({
  find: Schema.Literals(["blocks", "pages"]),
  where: Schema.optionalKey(Filter),
  sort: Schema.optionalKey(Schema.Array(Sort)),
  group: Schema.optionalKey(Field),
  view: Schema.optionalKey(View),
  limit: Schema.optionalKey(Schema.Int),
})
export type Query = typeof Query.Type

export const decodeQuery = Schema.decodeUnknownSync(Query)

export const and = (filters: ReadonlyArray<Filter>): Filter | undefined =>
  filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { _tag: "And", all: filters }

export const or = (filters: ReadonlyArray<Filter>): Filter =>
  filters.length === 1 ? filters[0]! : { _tag: "Or", any: filters }

export const today: Value = { _tag: "RelDate", amount: 0, unit: "d" }

const flat = (tag: "And" | "Or", items: ReadonlyArray<Filter>): Filter[] =>
  items.flatMap((f) => {
    const n = normalizeFilter(f)
    return n._tag === "And" && tag === "And" ? n.all : n._tag === "Or" && tag === "Or" ? n.any : [n]
  })

export const normalizeFilter = (f: Filter): Filter => {
  switch (f._tag) {
    case "And":
      return and(flat("And", f.all)) ?? f
    case "Or":
      return or(flat("Or", f.any))
    case "Not":
      return { _tag: "Not", filter: normalizeFilter(f.filter) }
    case "In":
      return f.values.length === 1 ? { _tag: "Compare", field: f.field, op: "=", value: f.values[0]! } : f
    case "Under":
      return { ...f, ancestor: normalizeFilter(f.ancestor) }
    case "HasBlock":
      return { _tag: "HasBlock", filter: normalizeFilter(f.filter) }
    default:
      return f
  }
}

export const finishQuery = (input: unknown): Query => {
  const q = decodeQuery(input)
  const { view, where, ...rest } = q
  return {
    ...rest,
    ...(where ? { where: normalizeFilter(where) } : {}),
    ...(view && view._tag !== "List" ? { view } : {}),
  }
}
