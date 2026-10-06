import init, { type Database, type PreparedStatement } from "@sqlite.org/sqlite-wasm"
import { Effect, Layer } from "effect"
import { IndexError, Sqlite, makeSqlite, toIndexError, type Driver } from "./sqlite.ts"

const driverOf = (db: Database): Driver => {
  const cache = new Map<string, PreparedStatement>()
  const prepare = (sql: string) => {
    const cached = cache.get(sql)
    if (cached !== undefined) return cached
    const statement = db.prepare(sql)
    cache.set(sql, statement)
    return statement
  }
  const bound = (sql: string, params: Parameters<Driver["run"]>[1]) => {
    const statement = prepare(sql)
    if (params.length > 0) statement.bind(params)
    return statement
  }
  return {
    exec: (sql) => void db.exec(sql),
    run: (sql, params) => void bound(sql, params).stepReset(),
    all: (sql, params) => {
      const statement = bound(sql, params)
      const rows: Array<unknown> = []
      try {
        while (statement.step()) rows.push(statement.get([]))
      } finally {
        statement.reset()
      }
      return rows
    },
  }
}

const sqlite3 = Effect.tryPromise({ try: () => init(), catch: toIndexError })

const layerOf = (open: Effect.Effect<Database, IndexError>) =>
  Layer.effect(
    Sqlite,
    Effect.acquireRelease(open, (db) => Effect.sync(() => db.close())).pipe(
      Effect.map((db) => makeSqlite(driverOf(db))),
    ),
  )

export const layerWasm = (options: { readonly directory: string; readonly file: string }) =>
  layerOf(
    Effect.gen(function* () {
      const module = yield* sqlite3
      const pool = yield* Effect.tryPromise({
        try: () => module.installOpfsSAHPoolVfs({ directory: options.directory }),
        catch: toIndexError,
      })
      return yield* Effect.try({ try: () => new pool.OpfsSAHPoolDb(options.file), catch: toIndexError })
    }),
  )

export const layerWasmMemory = layerOf(
  Effect.flatMap(sqlite3, (module) =>
    Effect.try({ try: () => new module.oo1.DB(":memory:"), catch: toIndexError }),
  ),
)
