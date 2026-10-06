import { DatabaseSync, type StatementSync } from "node:sqlite"
import { transactionOf, type Db, type Row, type SqlValue } from "./db.ts"

export const openNodeDb = (path = ":memory:"): Db => {
  const db = new DatabaseSync(path)
  const cache = new Map<string, StatementSync>()
  const stmt = (sql: string) => {
    let s = cache.get(sql)
    if (s === undefined) {
      s = db.prepare(sql)
      s.setReturnArrays(true)
      cache.set(sql, s)
    }
    return s
  }
  const exec = (sql: string) => db.exec(sql)
  return {
    exec,
    all: (sql, params = []) => stmt(sql).all(...(params as SqlValue[])) as unknown as Row[],
    run: (sql, params = []) => void stmt(sql).run(...(params as SqlValue[])),
    transaction: transactionOf(exec),
  }
}
