declare module "datascript" {
  export interface Db {
    readonly __datascriptDb: unique symbol
  }

  export interface Datom {
    readonly e: number
    readonly a: unknown
    readonly v: unknown
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
      datoms: ReadonlyArray<readonly [number, unknown, unknown]>,
      schema: unknown,
    ) => Db
    readonly db_with: (db: Db, tx: ReadonlyArray<readonly unknown[]>) => Db
    readonly q: (query: string, ...sources: readonly unknown[]) => unknown
  }

  export default datascript
}
