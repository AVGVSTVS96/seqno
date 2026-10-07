# seqno

A TypeScript rebuild of Logseq: a local-first outliner. Web first (Chrome and Edge), then iOS (Expo) and desktop (Electron).

The source of truth is a Loro CRDT edit log (`loro-crdt` pinned to exactly 1.16.2). SQLite is a rebuildable index. Phase 0 decisions live in `spikes/*/RESULTS.md` and `spikes/decisions.json`; `spikes/` is read-only reference code.

## Commands

| Command          | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm check`     | lint, format check, typecheck, test. Run before every commit.    |
| `pnpm lint`      | oxlint with the `seqno` plugin, then the disable-directive guard |
| `pnpm fmt`       | oxfmt, writes files                                              |
| `pnpm typecheck` | `tsc --noEmit` in every workspace package                        |
| `pnpm test`      | Vitest across every workspace package (one project per package)  |

This machine runs many agents at once. Wrap every install, build, typecheck and test:

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm check
```

## Repo map

| Package           | Folder              | Side     | Job                                                                                  |
| ----------------- | ------------------- | -------- | ------------------------------------------------------------------------------------ |
| `@seqno/domain`   | `packages/domain`   | domain   | Schemas, branded ids, Command and GraphEvent unions. Pure.                           |
| `@seqno/rpc`      | `packages/rpc`      | contract | UI <-> core-worker contract (Effect RPC).                                            |
| `@seqno/syntax`   | `packages/syntax`   | pure     | Logseq markdown <-> block tree, exact round-trip. Pure.                              |
| `@seqno/query`    | `packages/query`    | pure     | Query text (Logseq-style and Dataview-style) -> AST -> SQL. Pure.                    |
| `@seqno/graph`    | `packages/graph`    | core     | Loro graph: lazy open, commands, undo/redo, GraphEvents.                             |
| `@seqno/index`    | `packages/index`    | core     | SQLite schema, indexer from GraphEvents, backlinks, FTS, live queries.               |
| `@seqno/vault`    | `packages/vault`    | core     | Edit-log files: File System Access, OPFS and node-fs adapters, compaction.           |
| `@seqno/interop`  | `packages/interop`  | core     | Logseq OG graph import, markdown mirror writer.                                      |
| `@seqno/web`      | `apps/web`          | ui       | Vite app: shell, routing. `apps/web/src/worker/**` is the core worker (worker side). |
| `@seqno/outliner` | `features/outliner` | ui       | Virtualized block tree view, keyboard navigation, collapse, zoom, drag.              |
| `@seqno/editor`   | `features/editor`   | ui       | Focused-block CodeMirror editor, live markdown styling, `[[ (( #` autocomplete.      |
| `@seqno/sync-sim` | `tools/sync-sim`    | tool     | Multi-device fake-iCloud simulator driving the real graph and vault.                 |
| `@seqno/e2e`      | `tools/e2e`         | tool     | Playwright harness, Feature Map, agent verify skill, CI workflow.                    |
| `@seqno/lint`     | `tools/lint`        | tool     | The `seqno` oxlint plugin that enforces the rules below.                             |
| -                 | `fixtures/`         | -        | Real Logseq graphs, 50k-block generator, edge-case graphs.                           |

A new folder under `packages/`, `apps/`, `features/` or `tools/` must be added to `repoMap` in `tools/lint/src/boundaries.ts` and to this table, or lint fails.

## Dependency rule

```
                 domain   <- everyone may import it; it imports no @seqno package
                    ^
                 contract (rpc)   <- imports domain only
                 ^          ^
   ui side ------+          +------ core side
   apps/web                         pure: syntax, query (domain + pure)
   features/*                       core: graph, index, vault, interop
   (domain, rpc, pure, ui)          worker: apps/web/src/worker/** (core packages, never ui)

   tools/*  may import anything; nothing imports a tool
```

- The UI side imports only `@seqno/domain`, `@seqno/rpc`, the pure packages (`@seqno/syntax`, `@seqno/query`) and other UI packages. Blocks render with the same parser the core uses, not a second one. It never imports graph, index, vault or interop, and talks to the core only through `@seqno/rpc`.
- The core side never imports UI packages.
- The core worker entry lives in `apps/web/src/worker/`. Files there count as core side: they may import core packages and may not import UI code. UI files in `apps/web` may not import from `src/worker/` (start the worker with `new Worker(new URL(...))`, not an import).
- Relative imports never leave their package. Import another package by its `@seqno/*` name and list it in `package.json`.

## Code rules

- Effect services (`Context.Service`) and Layers for anything with effects.
- Schema at every boundary: decode unknown input with `Schema.decodeUnknown*`, never trust a cast.
- `_tag` unions, matched exhaustively (`Match.exhaustive`, or the `.match` of a `Schema.TaggedUnion`).
- Branded ids (`BlockId`, `PageId`, `DeviceId` from `@seqno/domain`).
- No `as` casts (only `as const`), no `any`.
- No code comments. The one exception is an outside fact the code cannot express (an upstream bug, a spec quirk), and that comment must carry the `https://` link to its source.
- No `useEffect`, `useLayoutEffect` or `useInsertionEffect`. Derive during render, act in event handlers, read outside state through `@effect/atom-react`.
- Tests call code the way users do and compare against literal values. A test that would still pass if the code returned `undefined` gets deleted.
- One blessed way to do each thing:
  - Relative imports end in `.ts` / `.tsx`.
  - A package's public API is `src/index.ts`, exposed through `"exports": { ".": "./src/index.ts" }`. No build step for workspace packages.
  - Tests live in `<package>/test/*.test.ts` and use `@effect/vitest` (`it.effect`) for Effect code.
  - Dependencies use exact versions. `effect` is `4.0.1`, `loro-crdt` is `1.16.2`.
- Effect v4 differs from v3: `Context.Service` instead of `Context.Tag`, `Result` instead of `Either`, Schema v4 names. Check the installed types and https://github.com/Effect-TS/effect/blob/main/MIGRATION.md.

## What enforces each rule

| Rule                                                                        | Enforced by                                                                                                                                               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No code comments (except linked outside facts)                              | `seqno/no-comments` (oxlint, `pnpm lint`)                                                                                                                 |
| No `useEffect` family                                                       | `seqno/no-use-effect` (oxlint)                                                                                                                            |
| No `as` casts except `as const`                                             | `seqno/no-as-cast` (oxlint)                                                                                                                               |
| No `any`                                                                    | `seqno/no-any` (oxlint) and `strict` tsconfig (`noImplicitAny`)                                                                                           |
| Dependency rule between packages                                            | `seqno/import-boundaries` (oxlint)                                                                                                                        |
| Relative imports stay inside their package                                  | `seqno/import-boundaries` (oxlint)                                                                                                                        |
| Every package folder is in the repo map                                     | `seqno/import-boundaries` (oxlint)                                                                                                                        |
| No `!` non-null assertions                                                  | `typescript/no-non-null-assertion` (oxlint)                                                                                                               |
| No `@ts-ignore` / `@ts-expect-error`                                        | `seqno/no-comments` and `typescript/ban-ts-comment` (oxlint)                                                                                              |
| No lint-disable escape hatches                                              | `tools/lint/src/directives.ts` (runs in `pnpm lint`)                                                                                                      |
| No import cycles                                                            | `import/no-cycle` (oxlint)                                                                                                                                |
| Strict types, checked index access                                          | `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                                                                 |
| Erasable TypeScript only (no enums, namespaces)                             | `tsconfig.base.json` (`erasableSyntaxOnly`)                                                                                                               |
| Formatting                                                                  | oxfmt (`oxfmt --check` in `pnpm check`)                                                                                                                   |
| Schema at boundaries, services and Layers, exhaustive matching, branded ids | Types: `@seqno/domain` and `@seqno/rpc` only expose Schemas and branded types, so unbranded or undecoded data does not typecheck. Review covers the rest. |
| Tests compare literal values                                                | Review                                                                                                                                                    |
| One blessed way                                                             | This file and review                                                                                                                                      |

Every lint message says how to fix the problem. Do not weaken a rule in `.oxlintrc.json` or add nested lint configs; if a rule blocks real work, report it.

## Shared contract

`@seqno/domain` holds the shared contract. Code against these names:

- `BlockId`, `PageId` (UUIDv7, branded), `DeviceId` (filename-safe ASCII, branded). Mint ids with `newBlockId` / `newPageId` (need the Effect `Crypto` service).
- `Block { id, pageId, parentId: BlockId | null, text, collapsed, props }`. Sibling order comes from the Loro tree, not a field.
- `Page { id, name, title, journalDay: number | null, props }`. `name` is `normalizePageName(title)`: NFC, trimmed, lowercase.
- `Command`: `CreatePage, RenamePage, DeletePage, InsertBlock, InsertBlocks, EditText, SplitBlock, MergeWithPrevious, Indent, Outdent, MoveBlocks, DeleteBlocks, SetCollapsed, SetProperty, Undo, Redo`. `InsertBlocks` inserts a tree of `BlockDraft`s (text, props, children) in one commit.
- `GraphEvent`: `PageUpserted, PageDeleted, BlockUpserted, BlockMoved, BlockDeleted`.

`@seqno/rpc` exports `CoreRpcs`: `OpenGraph`, `Dispatch`, `GetPages`, `GetPage`, `GetBlock`, `WatchPage` (stream), `WatchQuery` (stream, query text through `@seqno/query`), `Search` (full text, pages and blocks), `WatchBlockRefCounts` (stream, blocks referencing each block). `PageRpcs` adds backlinks, page stats, `Ancestors` and `WatchReferencedPages` (names that exist only as references).

If you need something the contract lacks, add it inside your own package and say so in your `RESULTS.md`; integration reconciles it.

## Working in this repo

- Each part works in its own git worktree on `phase1/<part>`. Never edit another part's folder.
- Commit with conventional-commit messages, author `Bassim Shahidy <bassim101@gmail.com>`. Only `git add` your own paths.
- Finish each part with `RESULTS.md` in its folder: what works, how to run its tests, known gaps.
