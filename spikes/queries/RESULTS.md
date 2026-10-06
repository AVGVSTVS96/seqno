# queries spike: results

**Verdict: go.** A typed query AST that compiles to SQLite clears the bar by about 3x. Live queries re-run only when the data they read changes. Numbers are **preliminary**: other agents were using the machine while they ran.

Setup: 50k-block fixture (`spikes/shared/fixture`, seed 20261006), headless Chrome 153, sqlite-wasm 3.53.4, `opfs-sahpool` in a worker, 40 timed runs per query.

| metric | result | bar |
|---|---|---|
| slowest query p95 (15 real queries) | **14.7 ms** (Q05, 4,110 rows) | ≤ 50 ms ✅ |
| median query p95 | 1.8 ms | |
| live queries re-run per keystroke, 20 open | **1.05** (0.05 not counting Q15) | re-run all = 20, key match only = 4.1 |
| stale results | **0** (Chrome: checked every 20 keystrokes; node: checked after each of 2,100 edits) | 0 ✅ |
| index update + live refresh per keystroke, in the worker, p95 | 16.0 ms durable / **6.7 ms relaxed** | (keystroke bar is 16 ms) |
| SQLite index write alone per keystroke, p50 / p95 | 7.1 / 11.9 ms durable, 2.1 / 3.4 ms relaxed | |
| build the 50k index from scratch | 2.4 s Chrome OPFS / 0.8 s node | only on first open or rebuild |
| corpus queries expressible | 15 of 18, in all 3 syntaxes, same AST | |
| Logseq advanced queries auto-translated | 12 of 14 (5 with warnings), 2 become "convert me" | |

**Q15 "Recently modified" accounts for nearly all re-runs.** It sorts on `updated`, so every keystroke really does change its result. It re-runs in 1.8 ms; debouncing it would be a product choice. The other 19 queries re-ran 102 times across 2,000 keystrokes.

**Durable vs relaxed** only differs in PRAGMAs. Durable is `journal_mode=truncate, synchronous=normal`. Relaxed is `journal_mode=memory, synchronous=off`. The index can be rebuilt from Loro, so relaxed is safe if the app stamps the index with the Loro version and rebuilds when the stamp doesn't match (see decision 2).

### Per query (Chrome, durable; ms)

| id | query | rows | p50 | p95 |
|---|---|---|---|---|
| Q01 | tasks by status | 1660 | 4.2 | 12.5 |
| Q02 | NOW/DOING on journals of the last 2 weeks, by priority | 14 | 1.5 | 1.8 |
| Q03 | next 7 days' deadline or scheduled, table | 4 | 0.2 | 0.3 |
| Q04 | open tasks with #tag, board | 34 | 1.1 | 1.3 |
| Q05 | all open tasks grouped by page | 4110 | 13.5 | 14.7 |
| Q06 | property value | 35 | 0.2 | 0.3 |
| Q07 | pages in a namespace, table of page props, sorted | 59 | 0.4 | 0.5 |
| Q08 | TODOs referencing the current page | 18 | 0.9 | 1.1 |
| Q09 | journal blocks of the last 7 days under `[[page]]` | 1 | 1.8 | 2.2 |
| Q10 | TODOs on pages under a namespace (any depth) | 22 | 0.6 | 0.8 |
| Q11 | TODOs nested anywhere under a block matching text (recursive CTE) | 59 | 6.9 | 7.8 |
| Q12 | TODOs not under a DOING task (recursive CTE + NOT) | 777 | 3.4 | 3.8 |
| Q13 | full text "deploy" and not a task | 2313 | 7.3 | 7.8 |
| Q14 | pages with a tag | 7 | 0.2 | 0.3 |
| Q15 | updated in the last day, newest first | 649 | 1.8 | 2.0 |

## How to rerun (Linux box, one command each, fixed seeds, JSON on stdout)

```sh
cd ~/dev/seqno/spikes/queries
node bench/web.ts                                  # Chrome + sqlite-wasm, durable PRAGMAs (main numbers)
node bench/web.ts --relaxed=1                      # same, relaxed PRAGMAs
node bench/web.ts --relaxed=1 --verify-every=20    # also checks every live result against a full re-run, in Chrome
node bench/node.ts                                 # node:sqlite 3.53.4 in memory (dev numbers)
npx vitest run                                     # 54 tests: syntax equivalence, printer round trip, translator, no-stale checks
node scripts/translate.ts                          # Logseq advanced queries -> seqno query text, or convert-me
```

`bench/web.ts` builds with Vite, serves `web/dist`, and runs headless Chrome through Playwright. Other flags: `--keystrokes=N` and `--runs=N`.

## Decision: which text syntax

Every syntax below parses to the same Effect Schema AST; tests check this for all 15 queries. Here are the same 3 queries in each:

**Q02: NOW/DOING tasks on journals of the last 2 weeks, by priority**
```
S  {{query (and (task now doing) (between -2w today) (sort-by priority asc))}}
D  LIST WHERE task.status IN (now, doing) AND page.day BETWEEN -2w AND today SORT task.priority ASC
E  {:where [[:task.status #{:now :doing}] [:page.day :between :-2w :today]] :sort-by [[:task.priority :asc]]}
```
**Q03: next 7 days' deadline or scheduled, as a table**
```
S  {{query (or (between task.scheduled today +7d) (between task.deadline today +7d)) (view table task.scheduled task.deadline page)}}
D  TABLE task.scheduled, task.deadline, page WHERE task.scheduled BETWEEN today AND +7d OR task.deadline BETWEEN today AND +7d
E  {:where [(or [:task.scheduled :between :today :+7d] [:task.deadline :between :today :+7d])] :view [:table :task.scheduled :task.deadline :page]}
```
**Q12: TODOs not under a DOING task** (in Logseq this took 20 lines of recursive Datalog rules)
```
S  {{query (and (task todo) (not (under (task doing))))}}
D  LIST WHERE task.status = todo AND NOT UNDER (task.status = doing)
E  {:where [[:task.status :todo] (not (under [:task.status :doing]))]}
```

- **S: Logseq-simple-like.** Logseq `{{query}}` blocks paste in and run unchanged, including inherited `[[page]]` matching. On top it adds typed fields (`(task.deadline <= +7d)`), `sort-by`, `group-by`, `view`, `limit`, `under`, `child-of` and `pages`. It's the shortest of the three (763 characters for all 15 queries) and has the smallest parser (~130 lines).
- **D: Dataview-like.** It's the most readable as English and familiar to Obsidian users, and it's good for tables. It doesn't look like Logseq and is longer (975 characters, 212 more than S). Dataview users will also expect functions and expressions, which we leave out on purpose.
- **E: Datalog-flavored EDN.** It looks like Logseq's advanced queries, but has no variables or joins. Logseq users would expect real Datalog and hit walls. It's the most verbose (1,119 characters).

**Recommendation: S.** It feels the same as Logseq. Imported simple queries keep working. The translator and printer already turn advanced queries into S. All three parse to one AST, so adding D later as a second input would cost about a day.

**Can't be expressed in any of the three (3 of 18):**
- Q16: filter on properties of the page a block references. This would need a `ref.page.property.x` field.
- Q17: aggregates. Every view shows its row count; there are no sums or averages.
- Q18: `:view` functions. Left out by design: views are declared, never user code.

Two more gaps:
- Dataview's `!completed` has no shorthand; you list open statuses. A `task.open` field would fix that.
- Dates stored in untyped properties can't be compared. That needs property types.

## Design in one screen

- **AST** (`src/model.ts`, Effect Schema):
  - Filter nodes: `And/Or/Not`, `Compare`, `In`, `Between`, `Has`, `Search`, `Under{ancestor, self, direct}`, `HasBlock`.
  - Query: `find blocks|pages`, `sort`, `group`, `view List|Table|Board`, `limit`.
  - Public fields only, checked by a regex in the schema: `page`, `page.day`, `page.journal`, `page.tag`, `page.alias`, `page.namespace`, `page.property.x`, `ref`, `tag`, `task.status`, `task.priority`, `task.scheduled`, `task.deadline`, `property.x`, `created`, `updated`, `id`.
  - `@page` and `@block` stand for the current page and the current block.
- **Index** (`src/schema.ts`):
  - Tables: `pages`, `page_names` (own name plus aliases), `page_tags`, `page_ns` (every ancestor namespace), `page_props`, `blocks` (rid, uuid, page, parent, content, created, updated), `tasks`, `refs` (target and is-tag flag), `props` (value and numeric value), and a contentless FTS5 table.
  - `src/fields.ts` is the only place that maps public field names to tables.
- **Compiler** (`src/compile.ts`):
  - Satellite tables become `rid IN (SELECT …)` so SQLite can drive from the selective side.
  - `Under` becomes a recursive CTE over `blocks.parent`.
  - Page names match aliases too.
  - NULL handling copies the in-memory evaluator exactly.
- **Live re-run** (`src/live.ts`), two levels:
  1. Keys. Each query registers keys such as `tag:database`, `task.status`, `text`, `property:type`, `tree` or `move` with **effect's `Reactivity`** service. Each edit invalidates only the keys whose facets actually changed. The index works this out by parsing the old and new block text and comparing.
  2. Rows. For woken block queries, the edited block's old and new facets are checked against the filter in memory. The query re-runs only if the block entered or left the result, or a sorted/grouped/shown value changed. `Under` nodes count as unchanged unless the edit flips the ancestor condition, so tree queries stay cheap while you type.

  There is no second database. The only in-memory state is the result rows and a page-metadata cache of about 1.9k entries.
- **Import** (`src/translate.ts`):
  - Logseq advanced queries are matched by pattern: `task`, `priority`, `between`, `page-ref`, `property`, `page-property`, `namespace`, `:block/refs`, `:block/page`, `:block/parent`, scheduled/deadline comparisons, recursive parent rules (both directions), `not`/`or`, inline rules, and `sort-by` result-transforms.
  - Anything else becomes a convert-me block that keeps the original text and gives the reason (e.g. `or-join is not translated`).
  - Translations that change meaning slightly carry warnings. Examples: namespaces now match every depth; substring matches became word search; a `:view` function is dropped.

## Caveats / not done

- **Semantic changes from Logseq:**
  - `namespace` matches every depth. That is what the forum asked for, and the translator warns about it.
  - Full-text search is FTS5 word/phrase matching, not substring matching.
  - `!=` means NOT `=`, so blocks without the field match. This is the same as Logseq's `(not …)` and Dataview's null handling.
- **Paths the oracle covers lightly or not at all:**
  - Alias changes re-subscribe the affected queries, but the random edits rarely touch `alias::` lines, so this path is barely tested.
  - Page renames and page creation or deletion aren't handled. The fixture's edit stream doesn't produce them.
- **Not measured or built:**
  - Memory wasn't measured.
  - Not built: UI rendering, query-builder UI, autocomplete, property types.
- **Fixture name stand-ins:** corpus queries were re-pointed at names that exist in the fixture (e.g. `#shopping` became `#database`). Each change is listed per query in `src/corpus.ts`.
- **No sub-agents:** this session had no Agent tool, so all work was done directly.

**Blocked:** nothing.

Files:
- `src/corpus.ts`: 18 real queries with sources
- `src/syntax/{simple,dql,edn,print}.ts`
- `src/{model,fields,schema,compile,index,evaluate,live,translate}.ts`
- `bench/{node,web}.ts`, `web/`
- `test/`
