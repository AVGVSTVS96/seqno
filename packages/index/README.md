# @seqno/index

The core side's SQLite index, built from `GraphEvent`s and rebuildable at any time: backlinks, unlinked references, full-text search, page stats, and live queries that re-run only when data they read changes.

## What's inside

| Export                     | What it does                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Index`                    | Effect service: `apply(events, stamp)`, `rebuild(stream, stamp)`, `stamp`, `query`, `watch(liveQuery)`, `search`, `backlinks`, `unlinkedReferences`, `pageStats`, `referencedPages`, `blockRefCounts`, and a `watch*` stream for each. |
| `Sqlite`, `makeSqlite`     | The driver port. A driver implements only `exec`, `run` and `all`; transactions and errors are shared.                                                                                                                                 |
| `@seqno/index/node`        | `layerNode(path?)` on `node:sqlite`, for tests and tools.                                                                                                                                                                              |
| `@seqno/index/wasm`        | `layerWasm({ directory, file })` on sqlite-wasm with an OPFS file, and `layerWasmMemory` in memory.                                                                                                                                    |
| `SCHEMA`, `SCHEMA_VERSION` | `@seqno/query`'s tables plus a `meta` table for the stamp. A file with another version is dropped and recreated.                                                                                                                       |
| `isReadKey`, `ReadKey`     | Turn `@seqno/query`'s read set into typed index keys.                                                                                                                                                                                  |

- `apply` writes the rows and the stamp in one transaction, so the stamp always matches the data.
- Each `apply` wakes only live queries whose keys changed. Typing in a block touches `text` and `updated`, nothing else.
- Events must come in order: a page before its blocks, a parent before its children. Otherwise the batch rolls back with `IndexError`.

## Tests

Every scenario runs on both `node:sqlite` and sqlite-wasm.

```sh
pnpm test --project @seqno/index
```

## Known gaps

- `layerWasm` (the OPFS file) has no tests here, and the web app uses `layerWasmMemory`, so the index is rebuilt on every open.
- Two pages with the same normalized name break `pages.name_lc UNIQUE` and fail the whole batch.
- A woken live query always re-runs; `@seqno/query`'s `blockChangeAffects` row check is not wired in.
