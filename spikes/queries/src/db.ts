export type SqlValue = string | number | null
export type Row = ReadonlyArray<SqlValue>

export interface Db {
  readonly exec: (sql: string) => void
  readonly all: (sql: string, params?: ReadonlyArray<SqlValue>) => Row[]
  readonly run: (sql: string, params?: ReadonlyArray<SqlValue>) => void
  readonly transaction: <A>(f: () => A) => A
}

export const transactionOf = (exec: (sql: string) => void) => <A>(f: () => A): A => {
  exec("BEGIN")
  try {
    const out = f()
    exec("COMMIT")
    return out
  } catch (e) {
    exec("ROLLBACK")
    throw e
  }
}
