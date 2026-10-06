import { Result } from "effect"
import type { Query, QueryContext } from "./ast.ts"
import { compile } from "./compile.ts"
import { attempt } from "./error.ts"
import type { Names } from "./evaluate.ts"
import type { BlockFacets } from "./facets.ts"
import * as Reads from "./readset.ts"
import { readDataview } from "./syntax/dataview.ts"
import { readLogseq } from "./syntax/logseq.ts"
import { printLogseq } from "./syntax/print.ts"

export { CompareOp, Field, Filter, Query, QueryContext, Sort, Value, View } from "./ast.ts"
export { Compiled, SqlValue } from "./compile.ts"
export { QueryError } from "./error.ts"
export type { Names } from "./evaluate.ts"
export { BlockFacets, PageFacets, TaskFacets } from "./facets.ts"
export { blockTouches, pageTouches } from "./readset.ts"
export { ALIASES_SQL, SCHEMA } from "./schema.ts"
export { Translation, translateLogseq as translateAdvancedQuery } from "./translate.ts"

export const parseLogseqQuery = (text: string) => attempt(() => readLogseq(text))

export const parseDataviewQuery = (text: string) => attempt(() => readDataview(text))

export const printLogseqQuery = (query: Query) => attempt(() => printLogseq(query))

export const compileQuery = (query: Query, ctx: QueryContext) => attempt(() => compile(query, ctx))

export const namesRead = (query: Query, ctx: QueryContext) => attempt(() => Reads.namesOf(query, ctx))

export const readSet = (query: Query, ctx: QueryContext, names: Names) => attempt(() => Reads.readSet(query, ctx, names))

export const blockChangeAffects = (
  query: Query,
  ctx: QueryContext,
  names: Names,
  before: BlockFacets | null,
  after: BlockFacets | null,
): boolean => Result.getOrElse(attempt(() => Reads.blockChangeAffects(query, ctx, names, before, after)), () => true)
