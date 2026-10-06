# @seqno/query: results

Pure TypeScript port of `spikes/queries`. It turns query text into a typed AST, then into SQL for the shared SQLite index. It also works out which edits should wake which live queries. It has no runtime deps besides `effect` 4.0.1, and it doesn't import `@seqno/domain`.

```
{{query ...}} ──parseLogseqQuery──┐
LIST/TABLE/BOARD ──parseDataviewQuery──┤──> Query AST ──compileQuery──> { sql, params, projections }
#+BEGIN_QUERY ──translateAdvancedQuery──┘        │
                                                 ├──readSet / namesRead ──> keys a live query listens to
BlockFacets before/after ──blockTouches──────────┼──> keys an edit invalidates
                                                 └──blockChangeAffects ──> re-run or skip this woken query
```

## What works

- **Logseq-style `{{query ...}}`** (primary). Real Logseq simple queries paste in unchanged. It adds typed fields, `sort-by`, `group-by`, `view`, `limit`, `under`, `child-of`, `has-block` and `pages`.
- **Dataview-style** `LIST | TABLE | BOARD ... FROM ... WHERE ... SORT ... GROUP BY ... LIMIT` (second input). It produces the same AST: all 15 corpus queries print to identical Logseq text from both syntaxes.
- **Printer** `printLogseqQuery`: AST back to `{{query ...}}`. Printed text reads back to itself.
- **Compiler** `compileQuery`: AST to SQLite SQL against `SCHEMA`, which is copied verbatim from the spike. Satellite tables become `rid IN (SELECT ...)`, `under` becomes a recursive CTE, and page names also match aliases.
- **Advanced-query translator** `translateAdvancedQuery`: same coverage as the spike. 12 of the 14 corpus queries translate (5 with warnings). The other 2 become `ConvertMe { original, reason }`.
- **Live-query support**:
  - `readSet` gives a query's keys, e.g. `tag:database`, `task.status`, `tree`.
  - `blockTouches` / `pageTouches` give the keys an edit invalidates, computed from before/after facets.
  - `blockChangeAffects` is the spike's row-level check: re-run only if the block entered or left the result, or a shown/sorted value changed. If it can't decide, it says re-run.
  - Keys are flat strings in the same `key` / `key:value` shape effect's `Reactivity` uses for record keys, so they plug straight into `Reactivity.registerUnsafe` / `invalidateUnsafe`.
- **Errors**: anything that can fail returns `Result<_, QueryError>` with a plain message, e.g. `unknown field "task.colour"`, `@page is only available inside a page`, `(limit) takes a whole number`. `QueryError` is a `Schema.TaggedError`, so it can cross RPC.

## Public API (`src/index.ts`)

| export | shape |
|---|---|
| `parseLogseqQuery(text)` / `parseDataviewQuery(text)` | `Result<Query, QueryError>` |
| `printLogseqQuery(query)` | `Result<string, QueryError>` |
| `compileQuery(query, ctx)` | `Result<Compiled, QueryError>`; `Compiled = { sql, params, projections }`; rows are `[rid, ...projections]` |
| `translateAdvancedQuery(text)` | `Translated { query, warnings } \| ConvertMe { original, reason }` |
| `namesRead(query, ctx)` | names to resolve with `ALIASES_SQL` before `readSet` |
| `readSet(query, ctx, names)` | `Result<string[], QueryError>` |
| `blockTouches(before, after)` / `pageTouches(before, after)` | `string[]` (`null` = created/deleted) |
| `blockChangeAffects(query, ctx, names, before, after)` | `boolean` |
| Schemas | `Query`, `Filter`, `Field`, `Value`, `View`, `Sort`, `QueryContext`, `Compiled`, `SqlValue`, `BlockFacets`, `PageFacets`, `TaskFacets`, `Translation`, `QueryError` |
| SQL | `SCHEMA` (index DDL), `ALIASES_SQL` (name -> name + aliases) |

`QueryContext = { today: YYYYMMDD, page?: page name, block?: block uuid }`.

## Run it

```sh
cd packages/query
pnpm install --ignore-workspace   # until the root workspace lands
pnpm typecheck                    # tsc 7, clean
pnpm test                         # vitest: 4 files, 98 tests
```

- `test/syntax.test.ts`: all 15 corpus queries, in both syntaxes, compared against literal printed text. Also literal ASTs for the tricky ones, and plain error messages.
- `test/compile.test.ts`: builds a real `node:sqlite` index from `SCHEMA` with 4 pages and 8 blocks. It runs the compiled SQL and checks the exact block ids in order: aliases, nested `[[ref]]`, recursive `not under`, FTS, journal windows, numeric properties, nulls-last sort + limit, table projections, `@page` / `@block`, pages queries, and compile errors.
- `test/translate.test.ts`: 15 advanced queries checked against literal printed output and warnings; 6 convert-me cases checked against exact reasons.
- `test/readset.test.ts`: literal key sets for reads and touches; typing words wakes nothing; row check re-runs only when it should.

Spike tests: the syntax and translator tests are kept, but rewritten. The old ones compared parser output to other parser output (`parseDql(x) == parseSimple(y)`), so they would still pass if everything returned `undefined`. The live no-stale tests need the 50k fixture and the indexer, so they belong in `@seqno/index`. The compile test above replaces them for this package.

## Changed from the spike

- The EDN syntax (option E) is dropped. Decision: Logseq-style is primary and Dataview-style is the second input.
- The live registry (row cache, SQL runs, `Reactivity` wiring) is not here. That's `@seqno/index`'s job. This package gives it the keys and the row check.
- Markdown facet extraction (`parseBlock`) is not here either. The indexer builds `BlockFacets` / `PageFacets`; this package defines their schemas.
- Touches are computed from before/after facets (`blockTouches`) instead of inside the spike's indexer. The key vocabulary now lives in one package.
- Unknown `(view x)` and non-integer or negative `limit` now fail with a message. The spike silently ignored them.

## Known gaps

- **Contract**: there are no branded ids. `QueryContext.block` is a plain uuid string and `page` is a normalized name. Integration can swap in `BlockId` once `@seqno/domain` lands.
- **`SCHEMA` is duplicated**: `@seqno/index` was told to copy the same spike schema. One package should own it; I suggest index imports `SCHEMA` and `ALIASES_SQL` from here.
- **Logseq semantics we don't match yet**:
  - `[[page]]` doesn't match blocks that sit on that page. Logseq's `path-refs` includes the block's own page.
  - A quoted date string such as `"2026-10-01"` stays a string. Only bare words and `[[Oct 5th, 2026]]` become dates.
  - Dates in untyped properties compare as text.
- **Page create/delete/rename**: `pageTouches` emits `page.name`. Every query listens to that, so these rare edits wake everything.
- **Not expressible** (same as the spike): Q16 (properties of a referenced page), Q17 (aggregates), Q18 (`:view` code).
- **Tooling**:
  - Not run through `oxfmt`. There's no root config yet, and the defaults would add semicolons, which doesn't match the house style.
  - `oxlint` skips everything under `.claude/` (hidden dir), so I linted a copy: 0 warnings.
  - No lockfile is committed. It was installed standalone with `--ignore-workspace`.
