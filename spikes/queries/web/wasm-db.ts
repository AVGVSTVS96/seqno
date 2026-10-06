import type { Database, PreparedStatement } from "@sqlite.org/sqlite-wasm"
import { transactionOf, type Db, type Row, type SqlValue } from "../src/db.ts"

export const wasmDb = (db: Database): Db => {
  const cache = new Map<string, PreparedStatement>()
  const stmt = (sql: string, params: ReadonlyArray<SqlValue>) => {
    let s = cache.get(sql)
    if (s === undefined) {
      s = db.prepare(sql)
      cache.set(sql, s)
    }
    if (params.length > 0) s.bind(params as SqlValue[])
    return s
  }
  const exec = (sql: string) => void db.exec(sql)
  return {
    exec,
    all: (sql, params = []) => {
      const s = stmt(sql, params)
      const rows: Row[] = []
      try {
        while (s.step()) rows.push(s.get([]) as SqlValue[])
      } finally {
        s.reset()
      }
      return rows
    },
    run: (sql, params = []) => void stmt(sql, params).stepReset(),
    transaction: transactionOf(exec),
  }
}
