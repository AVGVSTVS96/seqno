# @seqno/index results (phase 1)

The SQLite index, fed by `GraphEvent`s. It holds backlinks, FTS5 search, plain SQL queries, and live queries that re-run only when data they read changes. It is rebuildable: it carries a version stamp and uses relaxed durability.

## What works

```
GraphEvent[] ──apply(events, stamp)──▶ Index ──▶ one SQLite transaction (rows + stamp)
                                         │
                                         └──▶ changed keys ──▶ Reactivity ──▶ only the live queries that read them re-run
```

- **One service, two drivers.** `Index` needs a `Sqlite` service, and two driver layers provide it:
  - `layerNode(path?)` from `@seqno/index/node` (node:sqlite, used by tests and tools)
  - `layerWasm({ directory, file })` from `@seqno/index/wasm` (official sqlite-wasm 3.53.4 with `opfs-sahpool`, for the browser worker)
  - `layerWasmMemory`, the same wasm build with an in-memory db. Every test runs on both node:sqlite and sqlite-wasm.
  - A driver only implements `exec`, `run` and `all`. Transactions, error mapping and row checks are shared code (`makeSqlite`).
- **Schema** is copied from `spikes/queries/src/schema.ts`, so the query compiler's SQL runs as-is. The only addition is a `meta` table that holds the stamp.
- **Version stamp, rebuild on mismatch.**
  - `PRAGMA user_version` holds `SCHEMA_VERSION`. If an index file has another version, it is dropped and recreated when it opens.
  - `apply(events, stamp)` writes the stamp in the same transaction as the rows, so the stamp always matches the data, even after a crash with relaxed durability.
  - `stamp` returns `Option<string>`. The graph compares it with its Loro version. On a mismatch it calls `rebuild(stream, stamp)`, which recreates the tables, indexes the stream in batches of 2,000, and then writes the stamp. If a rebuild dies halfway, the stamp stays empty, so the next open rebuilds again.
  - `apply` and `rebuild` share a one-permit semaphore, so edits wait until a rebuild finishes.
- **Relaxed durability**: `journal_mode=memory, synchronous=off` (decision 2 in the spike).
- **Indexer** (`src/indexer.ts`): matches every `GraphEvent` exhaustively.
  - Upserts compare the old row and its facets (refs, tags, props, task) with the new ones. Only the satellite tables that changed get rewritten.
  - Moving a block to another page moves its whole subtree (one recursive CTE).
  - `BlockDeleted` removes the subtree. `PageDeleted` removes the page's blocks.
  - Deleting an id that isn't indexed does nothing, so the graph may also send deletes for every descendant.
- **Backlinks**: `backlinks(pageId)` finds blocks that link the page by name, by alias, by `#tag`, or through a `tags::` property. The page's own blocks are left out. Journals come first, newest first, then pages A to Z.
- **Search**: `search(text, limit = 20)` returns `{ pages, blocks }`.
  - Pages match by substring on the name or an alias.
  - Blocks match through FTS5 with the last word as a prefix (search as you type).
  - User text is always quoted, so FTS syntax in the input can't break the query.
- **Live queries**: `watch({ sql, params, reads })` is a `Stream` of row sets. It emits once at the start and again each time the query re-runs.
  - `reads` uses the spike's key vocabulary (`ReadKey`): `exist`, `tree`, `move`, `text`, `created`, `updated`, `task.status|priority|scheduled|deadline`, `ref` / `ref:<name>`, `tag` / `tag:<name>`, `property` / `property:<key>`, `page.name`, `page.alias`, `page.tag[:<name>]`, `page.namespace[:<ns>]`, `page.property[:<key>]`.
  - Each `apply` invalidates only the keys whose facets really changed. Typing in a block touches `text` and `updated` and nothing else, unless you add a tag, ref, marker or property.
  - `rebuild` wakes every live query.

### Numbers (node 24, this machine with other agents running; 50k blocks, 2k pages)

|                                                        | node:sqlite    | sqlite-wasm (in memory, in node) |
| ------------------------------------------------------ | -------------- | -------------------------------- |
| rebuild 50k blocks                                     | 2.9 s          | 6.3 s                            |
| one keystroke `apply` (index write + stamp), p50 / p95 | 0.08 / 0.25 ms | 0.19 / 0.36 ms                   |
| backlinks for a page linked by 12.5k blocks            | 38 ms          | 126 ms                           |
| search, 50 hits                                        | 12 ms          | 24 ms                            |

These come from a throwaway script, not a checked-in benchmark.

## How to run its tests

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm vitest run --project @seqno/index
```

23 tests in `test/index.test.ts`. Eleven scenarios run on each driver, plus a file-backed node test (stamp kept across reopen; a different schema version opens empty). The live-query tests put the stamp in the query result, so an extra re-run would show up as a wrong literal. I checked this by making `watch` subscribe to extra keys: 4 tests failed.

## Contract additions (for integration to reconcile)

- **Event order.** Within and across batches, a page's `PageUpserted` must come before its blocks, and a parent block before its children. Otherwise the whole batch rolls back with `IndexError` ("page ... is not indexed: send its PageUpserted before its blocks"), and the stamp stays where it was.
- **Props come from `Block.props` and `Page.props`, not from `key:: value` lines in `text`.** `[[refs]]` and `#tags` anywhere in the text still count. Page tags and aliases come from the `tags` and `alias` keys of `Page.props`. If the graph keeps property lines only inside `text`, it should also fill `props`.
- Exports: `Index`, `IndexError`, `LiveQuery`, `ReadKey`, `BlockHit`, `PageHit`, `SearchResult`, `Sqlite`, `makeSqlite`, `SCHEMA`, `SCHEMA_VERSION`. `WatchQuery` in `@seqno/rpc` can be `query compiler -> LiveQuery -> Index.watch`. The compiler's `reads` are the spike's `keysOf` (`spikes/queries/src/live.ts`) ported unchanged.
- `watch` emits on every re-run and doesn't dedupe equal results. That keeps re-runs observable. The RPC handler can add `Stream.changesWith` if it wants dedupe.

## Known gaps

- **Spike level-2 filtering is not here.** The spike also checks the edited block's old and new facets against the query AST before re-running. That needs the AST evaluator from `@seqno/query`, so integration adds it. Until then, every query woken by a key re-runs.
- **Block refs `((uuid))`** are not indexed (no block-ref counts yet). Unlinked references are not built.
- **Two pages with the same normalized name** (for example, the same journal created offline on two devices) break `pages.name_lc UNIQUE` and fail the batch. The graph has to merge them first, or the schema has to relax.
- **Corrupt index file**: a schema-version mismatch is handled, but a corrupt file (relaxed durability plus an OS crash during a commit) comes back as `IndexError`. The worker should then delete the file and rebuild. There is no automatic delete yet.
- **`layerWasm` (opfs-sahpool) is not tested here**, because it needs a browser worker. It makes the same calls the spike ran in headless Chrome. The web app's Vite config needs `optimizeDeps.exclude: ["@sqlite.org/sqlite-wasm"]` and `worker.format: "es"`.
- **Rebuild is 2-3x slower than the spike** (2.9 s vs 0.8 s in node). Each event looks up its existing row and decodes rows through Schema, which a fresh rebuild doesn't need. Rebuild runs in batches in the worker, so it doesn't block typing, but a rebuild-only fast path would win back most of it.
- `Block.collapsed` is not indexed (not in the spike schema; no query reads it).
