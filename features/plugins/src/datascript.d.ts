declare module "datascript" {
  export interface Db {
    readonly __datascriptDb: unique symbol
  }

  export interface EdnObject {
    readonly [key: string]: EdnValue
  }

  export interface EdnOpaque {
    readonly toString: () => string
  }

  export type EdnValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly EdnValue[]
    | EdnObject
    | EdnOpaque

  export interface Datom {
    readonly e: number
    readonly a: EdnValue
    readonly v: EdnValue
  }

  export interface Serialized {
    readonly count: number
    readonly tx0: number
    readonly "max-eid": number
    readonly "max-tx": number
    readonly schema: string
    readonly attrs: readonly string[]
    readonly keywords: readonly string[]
    readonly eavt: ReadonlyArray<readonly [number, number, unknown, number]>
    readonly aevt: readonly number[]
    readonly avet: readonly number[]
  }

  const datascript: {
    readonly from_serializable: (data: Serialized) => Db
    readonly datoms: (db: Db, index: string, ...components: readonly unknown[]) => Datom[]
    readonly init_db: (
      datoms: ReadonlyArray<readonly [number, EdnValue, EdnValue]>,
      schema: EdnValue,
    ) => Db
    readonly db_with: (db: Db, tx: ReadonlyArray<readonly unknown[]>) => Db
    readonly q: (query: string, ...sources: readonly unknown[]) => EdnValue
  }

  export default datascript
}
