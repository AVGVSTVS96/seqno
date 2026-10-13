import init, { type Database, type PreparedStatement } from "@sqlite.org/sqlite-wasm"
import { Effect, Layer } from "effect"
import { IndexError, Sqlite, makeSqlite, toIndexError, type Driver } from "./sqlite.ts"

const sqlite3 = Effect.tryPromise({ try: () => init(), catch: toIndexError })

type Module = Effect.Success<typeof sqlite3>

const deserializer =
  ({ capi, wasm }: Module) =>
  (target: Database, image: Uint8Array) =>
    target.checkRc(
      capi.sqlite3_deserialize(
        target,
        "main",
        wasm.allocFromTypedArray(image),
        image.byteLength,
        image.byteLength,
        capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
      ),
    )

const slow = <A>(label: string, run: () => A): A => {
  const started = performance.now()
  try {
    return run()
  } finally {
    const ms = performance.now() - started
    if (ms > 10)
      console.log(
        `seqno-t ${Date.now()} sql ${Math.round(ms)}ms ${label.replace(/\s+/g, " ").slice(0, 90)}`,
      )
  }
}

const driverOf = (module: Module, db: Database): Driver => {
  const into = deserializer(module)
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
    exec: (sql) => slow(sql, () => void db.exec(sql)),
    run: (sql, params) => slow(sql, () => void bound(sql, params).stepReset()),
    all: (sql, params) =>
      slow(sql, () => {
        const statement = bound(sql, params)
        const rows: Array<unknown> = []
        try {
          while (statement.step()) rows.push(statement.get([]))
        } finally {
          statement.reset()
        }
        return rows
      }),
    serialize: () => slow("serialize", () => module.capi.sqlite3_js_db_export(db)),
    deserialize: (image) =>
      slow("deserialize", () => {
        const scratch = new module.oo1.DB(":memory:")
        try {
          into(scratch, image)
          scratch.exec("SELECT count(*) FROM sqlite_schema")
        } finally {
          scratch.close()
        }
        cache.forEach((statement) => statement.finalize())
        cache.clear()
        into(db, image)
      }),
  }
}

const layerOf = (open: (module: Module) => Effect.Effect<Database, IndexError>) =>
  Layer.effect(
    Sqlite,
    Effect.flatMap(sqlite3, (module) =>
      Effect.acquireRelease(open(module), (db) => Effect.sync(() => db.close())).pipe(
        Effect.map((db) => makeSqlite(driverOf(module, db))),
      ),
    ),
  )

export const layerWasm = (options: { readonly directory: string; readonly file: string }) =>
  layerOf((module) =>
    Effect.gen(function* () {
      const pool = yield* Effect.tryPromise({
        try: () => module.installOpfsSAHPoolVfs({ directory: options.directory }),
        catch: toIndexError,
      })
      return yield* Effect.try({
        try: () => new pool.OpfsSAHPoolDb(options.file),
        catch: toIndexError,
      })
    }),
  )

export const layerWasmMemory = layerOf((module) =>
  Effect.try({ try: () => new module.oo1.DB(":memory:"), catch: toIndexError }),
)
