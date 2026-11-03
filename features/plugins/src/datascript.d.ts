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
    readonly attrs: ReadonlyArray<string>
    readonly keywords: ReadonlyArray<string>
    readonly eavt: ReadonlyArray<readonly [number, number, unknown, number]>
    readonly aevt: ReadonlyArray<number>
    readonly avet: ReadonlyArray<number>
  }

  const datascript: {
    readonly from_serializable: (data: Serialized) => Db
    readonly datoms: (db: Db, index: string, ...components: ReadonlyArray<unknown>) => Array<Datom>
    readonly init_db: (
      datoms: ReadonlyArray<readonly [number, unknown, unknown]>,
      schema: unknown,
    ) => Db
    readonly db_with: (db: Db, tx: ReadonlyArray<ReadonlyArray<unknown>>) => Db
    readonly q: (query: string, ...sources: ReadonlyArray<unknown>) => unknown
  }
  export default datascript
}
