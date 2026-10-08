# @seqno/fixtures

Test data for the other packages, not app code: a seeded 50k-block graph generator, small Logseq graphs for import edge cases, and a downloader for real Logseq graphs.

## What's inside

| Import or path              | What it holds                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@seqno/fixtures`           | `generateGraph`, `generateEdits`, `applyEdits`, `graphDigest`, `graphStats`, `toLogseqFiles`, `ogGeneratedGraph`, `largeFlatGraph`, `readGraph`, `writeGraph`. Runs in the browser, a worker or node.                                      |
| `@seqno/fixtures/cases`     | `edgeCases`, `edgeCase(name)`, `graphsDir`: every edge case with the import behavior it expects. Node only.                                                                                                                                |
| `@seqno/fixtures/downloads` | `download(source)`, `logseqDocs`, `downloadsDir`. Node only.                                                                                                                                                                               |
| `graphs/<case>/`            | Committed Logseq graphs: one per case in Logseq's [og_import_graph_cases.md](https://github.com/logseq/logseq/blob/master/docs/og_import_graph_cases.md), plus `og-syntax-mix` (parsing fidelity) and `showcase` (design harness content). |
| `src/cli.ts`                | `node src/cli.ts generate`, `stats`, `edge-case <name>` and `download`.                                                                                                                                                                    |

- `generateGraph()` (seed 20261006) makes 1,500 pages, 365 journals and 50,000 blocks with digest `5405c909c0dd19e2`. `toLogseqFiles` writes any generated graph as a Logseq folder.
- `ogGeneratedGraph(seed)` ports Logseq's own random graph generator and matches upstream byte for byte for seeds 1309, 42 and 8675309.
- `large-flat-file`, `og-generated-42` and `og-generated-8675309` are generated on demand rather than committed.
- `download` fetches logseq/docs at a pinned commit into `downloads/` (gitignored) and checks that its license is still MIT.
- `graphs/**` is `-text` in `.gitattributes`, so CRLF and empty files check out byte for byte.
- Generated ids are UUID v4-shaped, not v7, so the digests stay stable.

## Tests

```sh
pnpm test --project @seqno/fixtures
```

## Known gaps

- The edge cases' `expect` strings in `src/cases.ts` are prose; no test asserts them yet.
- `og-syntax-mix/pages/Café NFD.md` is stored NFD, but on macOS with `core.precomposeunicode` on it checks out as NFC.
- `fixtures/` is outside lint and format: the root ignore patterns skip it.
