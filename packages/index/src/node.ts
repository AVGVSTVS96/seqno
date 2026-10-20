import { DatabaseSync, type StatementSync } from "node:sqlite"
import { Effect, Layer } from "effect"
import { Sqlite, makeSqlite, toIndexError, type Driver } from "./sqlite.ts"

const statementCache = (db: DatabaseSync, configure: (statement: StatementSync) => void) => {
  const cache = new Map<string, StatementSync>()
  return {
    prepare: (sql: string) => {
      const cached = cache.get(sql)
      if (cached !== undefined) return cached
      const statement = db.prepare(sql)
      configure(statement)
      cache.set(sql, statement)
      return statement
    },
    clear: () => cache.clear(),
  }
}

const driverOf = (db: DatabaseSync): Driver => {
  const reads = statementCache(db, (statement) => statement.setReturnArrays(true))
  // FTS5 deletes leave last_insert_rowid on a tombstone page whose rowid is past 2^53, more than run() can return as a number: https://github.com/sqlite/sqlite/blob/1f3e5e763dbee918ae8f8c44b84bb98f8d0fa2d6/ext/fts5/fts5_index.c#L304
  const writes = statementCache(db, (statement) => statement.setReadBigInts(true))
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => void writes.prepare(sql).run(...params),
    all: (sql, params) => reads.prepare(sql).all(...params),
    serialize: () => db.serialize(),
    deserialize: (image) => {
      const scratch = new DatabaseSync(":memory:")
      try {
        scratch.deserialize(image)
        scratch.exec("SELECT count(*) FROM sqlite_schema")
      } finally {
        scratch.close()
      }
      reads.clear()
      writes.clear()
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
