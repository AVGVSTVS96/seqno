import { expressible } from "./corpus.ts"
import type { QueryContext } from "./literal.ts"
import type { Query } from "./model.ts"
import { parseSimple } from "./syntax/simple.ts"

export const TODAY = 20251231

export interface Named {
  readonly name: string
  readonly query: Query
  readonly ctx: QueryContext
}

const EXTRA = [
  ["L16 open tasks under [[Hidden Finance]]", "(and (task todo doing) [[Hidden Finance]])"],
  ["L17 rating 5", "(property rating 5)"],
  ["L18 deadlines in the last week", "(between task.deadline -7d today)"],
  ["L19 full text 'review'", '"review"'],
  ["L20 done tasks tagged #vision", "(and (tag vision) (task done))"],
] as const

export const measured: ReadonlyArray<Named> = expressible.map((e) => ({
  name: `${e.id} ${e.title}`,
  query: parseSimple(e.simple!),
  ctx: { today: TODAY, ...(e.page ? { page: e.page } : {}) },
}))

export const liveSet: ReadonlyArray<Named> = [
  ...measured,
  ...EXTRA.map(([name, src]) => ({ name, query: parseSimple(src), ctx: { today: TODAY } })),
]
