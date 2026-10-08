# @seqno/query

A pure compiler from query text (Logseq `{{query ...}}`, Dataview-style `LIST` / `TABLE` / `BOARD`, and Logseq advanced queries) to one typed AST, then to SQL for the index.

## What's inside

| Export                                        | What it does                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `parseLogseqQuery`, `parseDataviewQuery`      | Text to a `Query`, as `Result<Query, QueryError>` with a plain message on failure.           |
| `printLogseqQuery`                            | A `Query` back to `{{query ...}}` text.                                                      |
| `translateAdvancedQuery`                      | `#+BEGIN_QUERY` Datalog to a `Query` with warnings, or `ConvertMe` with the reason it can't. |
| `compileQuery`                                | A `Query` to `{ sql, params, projections }` against `SCHEMA`.                                |
| `namesRead`, `readSet`                        | The keys a live query listens to, such as `tag:database` or `task.status`.                   |
| `blockTouches`, `pageTouches`                 | The keys an edit changes, from the block's or page's facets before and after.                |
| `blockChangeAffects`                          | Whether one block edit can change a woken query's rows.                                      |
| `SCHEMA`, `ALIASES_SQL`                       | The SQLite tables `@seqno/index` builds, and the name-to-aliases lookup.                     |
| `Query`, `Filter`, `Field`, `QueryError`, ... | The AST, facet and error Schemas.                                                            |

Keys use the same `key` / `key:value` shape as Effect's `Reactivity`, so `@seqno/index` wakes live queries with them directly.

## Tests

```sh
pnpm test --project @seqno/query
```

## Known gaps

- A `[[page]]` filter matches only blocks that link the page themselves. Logseq's `path-refs` also match blocks on that page and children of a linking block.
- A quoted date such as `"2026-10-01"` stays a string, and dates in untyped properties compare as text.
- Advanced queries with aggregates or `:result-transform` become `ConvertMe`; a custom `:view` is dropped with a warning.
