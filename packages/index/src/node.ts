import { DatabaseSync, type StatementSync } from "node:sqlite"
import { Effect, Layer } from "effect"
import { Sqlite, makeSqlite, toIndexError, type Driver } from "./sqlite.ts"

const driverOf = (db: DatabaseSync): Driver => {
  const cache = new Map<string, StatementSync>()
  const prepare = (sql: string) => {
    const cached = cache.get(sql)
    if (cached !== undefined) return cached
    const statement = db.prepare(sql)
    statement.setReturnArrays(true)
    cache.set(sql, statement)
    return statement
  }
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => void prepare(sql).run(...params),
    all: (sql, params) => prepare(sql).all(...params),
    serialize: () => db.serialize(),
    deserialize: (image) => {
      const scratch = new DatabaseSync(":memory:")
      try {
        scratch.deserialize(image)
        scratch.exec("SELECT count(*) FROM sqlite_schema")
      } finally {
        scratch.close()
      }
      cache.clear()
      db.close()
      db.open()
      db.deserialize(image)
    },
  }
}

export const layerNode = (path = ":memory:") =>
  Layer.effect(
    Sqlite,
    Effect.acquireRelease(
      Effect.try({ try: () => new DatabaseSync(path), catch: toIndexError }),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.map((db) => makeSqlite(driverOf(db)))),
  )
