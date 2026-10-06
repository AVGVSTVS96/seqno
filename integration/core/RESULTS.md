# integrate-core results

Branch `phase1/integrate-core`, cut from `main` (the scaffold). It merges the core-side parts, makes them pass the repo's rules, and wires them to each other.

`pnpm check` passes: lint, format check, typecheck, and 278 tests in 23 files.

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm check
```

## Merges, in order

| Branch            | Tests | What the merge needed                                                                                                                                            |
| ----------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase1/syntax`   |    17 | Built outside the workspace: switched to the base tsconfig, dropped its own vitest config, oxfmt, and fixed its lint errors (`fc` namespace import, `toSorted`). |
| `phase1/query`    |    98 | Same workspace alignment, oxfmt, and 3 helpers hoisted out of `translateDatalog` (`consistent-function-scoping`).                                                |
| `phase1/fixtures` |    20 | Added `fixtures` to `pnpm-workspace.yaml` and the root vitest projects, base tsconfig, dropped its local lockfile.                                               |
| `phase1/graph`    |    22 | Lockfile only.                                                                                                                                                   |
| `phase1/index`    |    23 | Lockfile only.                                                                                                                                                   |
| `phase1/vault`    |    22 | Lockfile only (includes 3 headless-Chrome OPFS tests).                                                                                                           |
| `phase1/interop`  |    18 | Lockfile only.                                                                                                                                                   |
| `phase1/sync-sim` |     5 | Clean.                                                                                                                                                           |

Every lockfile conflict was resolved by taking this branch's side and re-running `pnpm install`, so the lockfile is always pnpm's own output. `pnpm install --frozen-lockfile` passes.

One root change: `vitest.config.ts` sets `maxWorkers: 4`. With one fork per core, the full test run peaked at 1.4 GB and the first `pnpm check` was OOM-killed inside the 1.5 GB scope. With 4 workers it peaks at 1.1 GB and takes the same 7 s.

## Wiring

```
  @seqno/query.SCHEMA ──> @seqno/index (adds only its meta table)
  @seqno/syntax ────────> @seqno/interop LogseqSyntaxLive (tree building)
  @seqno/graph ── vaultReplica(graph) ──> @seqno/vault.sync
  @seqno/graph events ──> @seqno/index.apply
  @seqno/vault ──────────> tools/sync-sim (realVaults layer, --vault real)
```

1. **Index schema has one owner.** `packages/index/src/schema.ts` builds its SQL from `@seqno/query`'s `SCHEMA` plus the `meta` table. The two copies were identical, so the query compiler and the indexer can no longer drift.
2. **Interop parses with `@seqno/syntax`.** `LogseqSyntaxLive` now gets the block tree from `parse` + `toOutline` and prints with `render`, then applies interop's own rule: the leading `key:: value` run goes to `props`. I checked it against the old stand-in on every markdown file I could find:
   - the 51 fixture files: identical parse and print
   - the 333 files of logseq/docs: 190 round-trip byte-for-byte, against 188 before, and no file got worse

   That comparison found one bug (a bare `-` bullet printed as `- `), now fixed and covered by a test.

3. **Graph to vault.** `vaultReplica(graph)` in `packages/graph/src/replica.ts` turns a `Graph` into the vault's `Replica`. It converts the version Map to a record, and turns graph's all-or-nothing `merge` into the vault's one-boolean-per-file answer. The core worker should use it.
4. **Sync-sim runs the real vault.** `tools/sync-sim/src/real-vault.ts` is a `Vaults` layer over `@seqno/vault`, with a 30-line adapter from the sim's cloud to the vault's `Storage`. `node tools/sync-sim/scripts/run.ts --suite ci --vault real` runs any suite against it.
   - The 50-seed CI suite passed 50/50 with zero violations (82 s, 250 MB per seed).
   - Compaction really runs: 53 snapshots written, and file counts drop from about 110-170 at peak to 30-60 at the end.
5. **End-to-end tests** in `tools/sync-sim/test/core.test.ts`:
   - Two devices, each a real `Graph` plus a real `Vault`, on the vault's fake cloud. A page and block created on one device show up on the other, and an edit comes back the other way.
   - Real graph events applied to a real index give the expected backlinks, FTS search hit and stamp.

## Known gaps and decisions for you

- **Where properties live.** Graph, index and interop keep properties in `Block.props`, apart from the text. Syntax treats the text as the only source and derives props from it (`analyzeBlock`, `setProperty`). They work together today because nothing calls syntax's property path. Pick one model before the editor shows `key:: value` lines.
- **Logseq ids.** `BlockId` accepts UUIDv7 only, but Logseq `id::` values are v4. Interop keeps v4 ids in `props.id` and mints new v7 ids. Fixtures and interop both suggest letting `BlockId` accept any UUID.
- **Import needs a bulk load.** Interop returns `PageTree[]`, but the graph has no entry point that loads pages with their given ids. Commands carry no ids, so replaying them would lose `id::` refs.
- **Sync-sim still uses its stand-in graph.** Its checks read things the real `Graph` doesn't expose: `fate(id)`, a canonical dump, live node count, and export from a version. Swapping it in means adding a read-only inspection API to the graph.
- **The 5 vault mutants run against the stand-in vault only.** The real vault has no bug switches.
- **`fixtures/` code is not linted or formatted.** The scaffold's ignore patterns exclude all of `fixtures/**`. Narrowing them to the graph data shows 55 lint errors in the generator, mostly `!` assertions in code ported from the spike. I left them alone because the generator's digests must stay stable.
- **Smaller gaps:**
  - `CreatePage` has no `journalDay`.
  - The graph has no `eventsSince(version)`, so a stale index must rebuild from every page.
  - The index rejects two pages with the same normalized name, so the graph has to merge them first.
  - The full sync-sim 1k and 10k suites were not run.
