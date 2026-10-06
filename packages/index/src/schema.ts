import { SCHEMA as QUERY_SCHEMA } from "@seqno/query"
import type { Statements } from "./sqlite.ts"

export const SCHEMA_VERSION = 1

export const RELAXED = `
PRAGMA journal_mode = memory;
PRAGMA synchronous = off;
PRAGMA temp_store = memory;
PRAGMA cache_size = -32000;
`

export const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
${QUERY_SCHEMA}`

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`

export const schemaVersion = (db: Statements): number => {
  const version = db.all("PRAGMA user_version")[0]?.[0]
  return typeof version === "number" ? version : 0
}

export const recreate = (db: Statements): void => {
  const tables = db.all(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY sql LIKE 'CREATE VIRTUAL TABLE%' DESC",
  )
  for (const [name] of tables) db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(String(name))}`)
  db.exec(SCHEMA)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

export const readStamp = (db: Statements): string | null => {
  const stamp = db.all("SELECT value FROM meta WHERE key = 'stamp'")[0]?.[0]
  return typeof stamp === "string" ? stamp : null
}

export const writeStamp = (db: Statements, stamp: string | null): void => {
  if (stamp === null) db.run("DELETE FROM meta WHERE key = 'stamp'")
  else db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('stamp', ?)", [stamp])
}
