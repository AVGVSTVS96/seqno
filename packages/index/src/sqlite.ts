import { Context, Effect, Schema } from "effect"

export const SqlValue = Schema.Union([Schema.String, Schema.Number, Schema.Null])
export type SqlValue = typeof SqlValue.Type

export const Row = Schema.Array(SqlValue)
export type Row = typeof Row.Type

export class IndexError extends Schema.TaggedError<IndexError>()("IndexError", {
  message: Schema.String,
}) {}

export interface Driver {
  readonly exec: (sql: string) => void
  readonly run: (sql: string, params: ReadonlyArray<SqlValue>) => void
  readonly all: (sql: string, params: ReadonlyArray<SqlValue>) => ReadonlyArray<unknown>
  readonly serialize: () => Uint8Array<ArrayBuffer>
  readonly deserialize: (image: Uint8Array) => void
}

export interface Statements {
  readonly exec: (sql: string) => void
  readonly run: (sql: string, params?: ReadonlyArray<SqlValue>) => void
  readonly all: (sql: string, params?: ReadonlyArray<SqlValue>) => ReadonlyArray<Row>
}

export class Sqlite extends Context.Service<
  Sqlite,
  {
    readonly use: <A>(body: (db: Statements) => A) => Effect.Effect<A, IndexError>
    readonly transaction: <A>(body: (db: Statements) => A) => Effect.Effect<A, IndexError>
    readonly serialize: Effect.Effect<Uint8Array<ArrayBuffer>, IndexError>
    readonly deserialize: (image: Uint8Array) => Effect.Effect<void, IndexError>
  }
>()("@seqno/index/Sqlite") {}

const isRow = Schema.is(Row)

const toRow = (row: unknown): Row => {
  if (isRow(row)) return row
  throw new IndexError({ message: "SQLite returned a value that is not text, a number or null" })
}

export const toIndexError = (cause: unknown): IndexError =>
  cause instanceof IndexError
    ? cause
    : new IndexError({ message: cause instanceof Error ? cause.message : String(cause) })

const attempt = <A>(body: () => A) => Effect.try({ try: body, catch: toIndexError })

export const makeSqlite = (driver: Driver) => {
  const db: Statements = {
    exec: driver.exec,
    run: (sql, params = []) => driver.run(sql, params),
    all: (sql, params = []) => driver.all(sql, params).map(toRow),
  }
  return Sqlite.of({
    use: (body) => attempt(() => body(db)),
    transaction: (body) =>
      attempt(() => {
        driver.exec("BEGIN")
        try {
          const result = body(db)
          driver.exec("COMMIT")
          return result
        } catch (cause) {
          driver.exec("ROLLBACK")
          throw cause
        }
      }),
    serialize: attempt(driver.serialize),
    deserialize: (image) => attempt(() => driver.deserialize(image)),
  })
}
