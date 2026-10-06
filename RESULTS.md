# Scaffold results (phase 1)

## What works

- Root pnpm workspace (`packages/*`, `apps/*`, `features/*`, `tools/*`), strict `tsconfig.base.json`, oxlint, oxfmt, `.editorconfig`. `pnpm check` runs lint, format check, typecheck and tests.
- `tools/lint` (`@seqno/lint`): an oxlint JS plugin named `seqno` with five rules, each message says how to fix the problem:
  - `no-comments` (a comment survives only if it carries an `https://` link to an outside fact)
  - `no-use-effect` (`useEffect`, `useLayoutEffect`, `useInsertionEffect`)
  - `no-as-cast` (everything except `as const`)
  - `no-any`
  - `import-boundaries` (the dependency rule; also relative imports leaving a package, and folders missing from the repo map)
  - plus `src/directives.ts`, which fails on `oxlint-disable` / `eslint-disable` comments, since oxlint has no switch to turn inline directives off.
- `packages/domain` (`@seqno/domain`): the shared contract as Effect Schemas with derived types.
- `packages/rpc` (`@seqno/rpc`): `CoreRpcs` group, tested through `RpcTest.makeClient` against an in-memory handler layer.
- `AGENTS.md`: repo map, dependency rule, code rules, and what enforces each one.

## How to run

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm check
```

Tests: `tools/lint/test` (rule tester cases for every rule), `packages/domain/test`, `packages/rpc/test`.

## Additions to the contract (for integration to reconcile)

- `newBlockId` / `newPageId` mint UUIDv7 ids through Effect's `Crypto` service. The core side provides the `Crypto` layer (the tests build one from Web Crypto with `Crypto.make`).
- `normalizePageName(title)` = NFC, trimmed, lowercase. `Page.name` must already be normalized, or decoding fails.
- `JournalDay` must be a real calendar day in `YYYYMMDD`.
- `DeviceId` is 1-64 chars of `[A-Za-z0-9_-]`, so it is safe in `updates/<deviceId>/` filenames.
- `SetProperty.target` is a tagged union, `BlockTarget { blockId } | PageTarget { pageId }`. Both ids are UUIDv7 strings, so a bare id would be ambiguous.
- `Indent`, `Outdent`, `MoveBlocks`, `DeleteBlocks` take a non-empty `blockIds` array. `EditText.from/to` and `SplitBlock.at` are non-negative ints.
- `BlockUpserted` also carries `createdAt` and `updatedAt` (epoch ms), because the spike SQLite schema has `blocks.created` and `blocks.updated`.
- `BlockMoved { blockId, pageId, parentId }` and `BlockDeleted { blockId, pageId }` carry the page so the index can update without a lookup.
- Commands carry no new ids. The core mints them, and `Dispatch` returns the resulting `GraphEvent`s, so the UI learns the new page or block id from the event.
- RPCs: `OpenGraph { graph } -> { graph, pages }`, `Dispatch { command } -> GraphEvent[]`, `GetPages`, `GetPage { pageId } -> PageTree { page, blocks }`, `GetBlock`, `WatchPage` (stream of `PageTree`), `WatchQuery { query }` (stream of `QueryResult = BlockRows | PageRows`). Errors: `GraphNotOpen`, `GraphUnavailable`, `PageNotFound`, `BlockNotFound`, `CommandRejected`, `QueryInvalid`.

## Decisions worth a look

- The import-graph check is an oxlint rule (`seqno/import-boundaries`), not a separate script, so one tool reports every rule with file and line.
- `apps/web/src/worker/**` counts as core side. The repo map gives `apps/web` the core-worker bootstrap, which has to import graph, index and vault; everything else in `apps/web` stays UI side.
- `tools/*` may import anything, and nothing may import a tool.
- `.claude/worktrees/` is gitignored, because oxlint otherwise walks into other agents' worktrees.

## Known gaps

- `MoveBlocks` with `parentId: null` means "top level"; the page comes from `after`, or stays the blocks' current page. Moving to the top of another page's root with no `after` block needs a `pageId` field.
- `EditText` offsets are UTF-16 code units (what CodeMirror reports). Loro text APIs default to Unicode code points, so the graph must use the UTF-16 variants.
- The `QueryResult` shape is a placeholder until `@seqno/query` settles its result types.
- Nested `.oxlintrc.json` files could still weaken rules. Nothing blocks them yet; AGENTS.md says not to add them.
