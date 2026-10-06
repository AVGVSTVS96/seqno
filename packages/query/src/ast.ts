import { Match, Schema } from "effect"

export const FIELD_PATTERN =
  /^(id|ref|tag|created|updated|task\.(status|priority|scheduled|deadline)|property\.[a-z0-9_-]+|page|page\.(journal|day|tag|alias|namespace)|page\.property\.[a-z0-9_-]+)$/

export const FixedField = Schema.Literals([
  "id",
  "ref",
  "tag",
  "created",
  "updated",
  "task.status",
  "task.priority",
  "task.scheduled",
  "task.deadline",
  "page",
  "page.journal",
  "page.day",
  "page.tag",
  "page.alias",
  "page.namespace",
])
export type FixedField = typeof FixedField.Type

export const Field = Schema.Union([
  FixedField,
  Schema.TemplateLiteral(["property.", Schema.String]),
  Schema.TemplateLiteral(["page.property.", Schema.String]),
]).pipe(Schema.check(Schema.isPattern(FIELD_PATTERN)))
export type Field = typeof Field.Type

export const isField = Schema.is(Field)
export const isFixedField = Schema.is(FixedField)

export const RelDate = Schema.TaggedStruct("RelDate", { amount: Schema.Int, unit: Schema.Literals(["d", "w", "m", "y"]) })
export type RelDate = typeof RelDate.Type
export const AbsDate = Schema.TaggedStruct("AbsDate", { ymd: Schema.Int })
export type AbsDate = typeof AbsDate.Type
export const Context = Schema.TaggedStruct("Context", { of: Schema.Literals(["page", "block"]) })
export type Context = typeof Context.Type

export const Value = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, RelDate, AbsDate, Context])
export type Value = typeof Value.Type

export const CompareOp = Schema.Literals(["=", "!=", "<", "<=", ">", ">="])
export type CompareOp = typeof CompareOp.Type
export const isCompareOp = Schema.is(CompareOp)

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

export type Under = Extract<Filter, { readonly _tag: "Under" }>

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
  limit: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
})
export type Query = typeof Query.Type

export const QueryContext = Schema.Struct({
  today: Schema.Int,
  page: Schema.optionalKey(Schema.String),
  block: Schema.optionalKey(Schema.String),
})
export type QueryContext = typeof QueryContext.Type

export const and = (filters: ReadonlyArray<Filter>): Filter | undefined => {
  const [first] = filters
  return filters.length === 1 ? first : first === undefined ? undefined : { _tag: "And", all: filters }
}

export const or = (filters: ReadonlyArray<Filter>): Filter => {
  const [first] = filters
  return filters.length === 1 && first !== undefined ? first : { _tag: "Or", any: filters }
}

export const pathRef = (name: Value): Filter => ({
  _tag: "Under",
  ancestor: { _tag: "Compare", field: "ref", op: "=", value: name },
  self: true,
  direct: false,
})

const flat = (tag: "And" | "Or", items: ReadonlyArray<Filter>): Filter[] =>
  items.flatMap((f) => {
    const n = normalizeFilter(f)
    return n._tag === "And" && tag === "And" ? n.all : n._tag === "Or" && tag === "Or" ? n.any : [n]
  })

export const normalizeFilter = (f: Filter): Filter =>
  Match.valueTags(f, {
    And: (x): Filter => and(flat("And", x.all)) ?? x,
    Or: (x): Filter => or(flat("Or", x.any)),
    Not: (x): Filter => ({ _tag: "Not", filter: normalizeFilter(x.filter) }),
    In: (x): Filter => {
      const [only] = x.values
      return x.values.length === 1 && only !== undefined ? { _tag: "Compare", field: x.field, op: "=", value: only } : x
    },
    Under: (x): Filter => ({ ...x, ancestor: normalizeFilter(x.ancestor) }),
    HasBlock: (x): Filter => ({ _tag: "HasBlock", filter: normalizeFilter(x.filter) }),
    Compare: (x): Filter => x,
    Between: (x): Filter => x,
    Has: (x): Filter => x,
    Search: (x): Filter => x,
  })

const decodeQuery = Schema.decodeUnknownSync(Query)

export const finishQuery = (input: Query): Query => {
  const { view, where, ...rest } = decodeQuery(input)
  return {
    ...rest,
    ...(where ? { where: normalizeFilter(where) } : {}),
    ...(view && view._tag !== "List" ? { view } : {}),
  }
}
