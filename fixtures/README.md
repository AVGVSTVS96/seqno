# @seqno/fixtures

Test data for every seqno package: a seeded 50k-block graph generator, small Logseq OG edge-case graphs, and a script that downloads real Logseq graphs.

```
fixtures/
  src/generator/     seeded 50k-block graph + edit stream generator (ported from spikes/shared/fixture)
  src/og-generated.ts   port of Logseq's own random markdown graph generator + the 45k-line flat file
  src/cases.ts       manifest of every edge case (committed folder or generated on demand)
  src/downloads.ts   pinned real graphs to download
  src/cli.ts         seqno-fixtures CLI
  graphs/<case>/     committed edge-case graphs in Logseq OG layout (logseq/config.edn, pages/, journals/, assets/)
  downloads/         gitignored; filled by `pnpm download`
```

## Imports

| import | what | runs in |
|---|---|---|
| `@seqno/fixtures` | `generateGraph`, `generateEdits`, `applyEdits`, `graphDigest`, `graphStats`, `toLogseqFiles`, `ogGeneratedGraph`, `largeFlatGraph`, `readGraph`, `writeGraph` | browser, worker, node |
| `@seqno/fixtures/cases` | `edgeCases`, `edgeCase(name)`, `graphsDir` (absolute paths) | node |
| `@seqno/fixtures/downloads` | `download(source)`, `logseqDocs`, `downloadsDir` | node |

```ts
import { generateGraph, graphDigest, toLogseqFiles } from "@seqno/fixtures"

const graph = generateGraph()          // seed 20261006: 1,500 pages, 365 journals, 50,000 blocks
graphDigest(graph)                     // "5405c909c0dd19e2", same as phase 0
const files = toLogseqFiles(graph)     // [{ path: "logseq/config.edn", content }, { path: "pages/….md", content }, ...]
```

```ts
import { edgeCase } from "@seqno/fixtures/cases"

const c = edgeCase("missing-block-refs")
// c.source: { _tag: "Committed", dir: "/abs/path/fixtures/graphs/missing-block-refs/" }
//        or { _tag: "Generated", files: () => GraphFile[] }   (large-flat-file, og-generated-42, og-generated-8675309)
```

## CLI

```sh
node src/cli.ts generate --out /tmp/g50k               # 50k graph as a Logseq OG folder (1,866 files)
node src/cli.ts generate --out /tmp/g --json           # same graph as graph.json
node src/cli.ts generate --seed 7 --blocks 300 --pages 20 --journals 5 --out /tmp/small
node src/cli.ts stats                                  # digest + shape (depth, refs, tasks, text length)
node src/cli.ts edge-case large-flat-file --out /tmp/flat
node src/cli.ts download                               # logseq/docs into fixtures/downloads/logseq-docs
```

## Generated graph

Same algorithm and output as `spikes/shared/fixture`, so phase 0 digests still hold: `5405c909c0dd19e2` for the default graph and `a9197d2c91dfba7c` after `generateEdits(graph, { seed: 1, count: 10_000 })`.

- Pages: lowercase single nouns, Title Case pairs, and `area/…` `project/…` namespaces. Journals are 2025-01-01 onward, named `Jan 1st, 2025`.
- Blocks are listed per page, depth-first, parents before children. Sibling order is the order in the list.
- Text is ASCII, 10-300 chars, with `[[refs]]`, `#tags`, `((block refs))` to earlier blocks, `**bold**`, `` `code` ``, links, task markers, `SCHEDULED:`/`DEADLINE:`, `key:: value` properties, and some multi-line blocks.
- Edits are a `_tag` union: `InsertText`, `DeleteText`, `CreateBlock`, `MoveBlock`, `DeleteBlock`.
- `toLogseqFiles` writes tab-indented OG markdown, `/` in page names as `___` (`:file/name-format :triple-lowbar`), journals as `journals/yyyy_MM_dd.md`, and adds `id:: <uuid>` to every block that another block references.

Block and page ids are UUID v4-shaped (kept from phase 0 so the digests match), not v7.

## Edge-case graphs

One graph per case in [logseq/docs/og_import_graph_cases.md](https://github.com/logseq/logseq/blob/master/docs/og_import_graph_cases.md), plus one extra. Content is taken from Logseq's own regression tests in `deps/graph-parser/test/logseq/graph_parser/exporter_test.cljs` where one exists.

| case | upstream case | source | what's in it |
|---|---|---|---|
| `legacy-journal-file-refs` | Legacy journal filename refs (#906) | committed | `[[2026_04_02]]` from a journal and from a page read first; `[[2026_04_03]]` and `[[May 19th, 2021]]` with no journal file; a date-named file under `pages/` |
| `missing-block-refs` | Missing block refs (#213 #340 #679 #748 #927) | committed | the upstream `A.md`/`Z.md`: plain pre-block, missing ref, missing embed, blocks whose only text is a missing ref (with properties, with a child) |
| `forward-block-refs` | Forward block refs (#850 #927) | committed | ref, embed and property ref to blocks in a later file, at three depths |
| `duplicated-block-ids` | Duplicated block ids | committed | the same `id::` twice in one file and once in another, an uppercase/lowercase pair, `id:: not-a-uuid` |
| `og-generated-1309` | Generated Markdown file graphs | committed | output of Logseq's generator, seed 1309 |
| `og-generated-42`, `og-generated-8675309` | Generated Markdown file graphs | generated | the other two upstream seeds |
| `recursive-block-refs` | Recursive block refs | committed | self ref, self embed, a 2-block cycle, a child embedding its parent |
| `missing-pages` | Missing pages | committed | `[[Missing Page]]` twice with different case, tags, `#[[multi word]]`, namespace child, property refs, invalid `[[2025_02_30]]`, `[[Feb 3rd, 2025]]` with no journal |
| `repeated-temporal` | Mixed repeated deadline and scheduled timestamps (#318) | committed | the upstream file plus `++3d` and a timed `+1m` |
| `linked-external-pdf` | Linked external PDF annotations (#923) | committed | `file:///…pdf` links with spaces, `hls__` pages, annotation EDN, an area-highlight image, an uppercase `.PDF`, and a highlight with missing attributes |
| `external-pdf-windows-https` | Windows and remote HTTPS linked PDF annotations (db-test#1140) | committed | `file://D:\…`, `https://…`, `?query#fragment`, and a PDF named only on its `hls__` page |
| `missing-local-pdf` | Missing local PDF asset links | committed | links and embeds to absent `../assets/*.pdf` and `.png` |
| `large-flat-file` | Large flat files (#931) | generated | 45,000 top-level `- large line N #tag` blocks (1 MB, so not committed) |
| `empty-files` | Empty imported files (#582) | committed | 0-byte and 1-byte (`\n`, `-`) journals and pages, an empty `.org`, one normal page |
| `og-syntax-mix` | (extra) parsing fidelity, tasks, queries, namespaces, aliases | committed | every heading form, every task marker, `{{query}}`, advanced and dataview queries, `___` and `%2F` namespace file names, `alias::`, `title::` overriding the file name, LOGBOOK, CRLF, an NFD file name, space indentation, no final newline |

Each case's expected import behaviour is in `src/cases.ts` (`expect`). `graphs/**` is marked `-text` in `.gitattributes` so CRLF and empty files survive checkout byte for byte.

## Downloaded graphs

| name | source | pinned commit | license | size |
|---|---|---|---|---|
| `logseq-docs` | https://github.com/logseq/docs | `08f855f24d66e4509b7ea808554c13b4649e6ee1` | MIT (`LICENSE.md`, checked on every download) | 6.7 MB: 242 pages, 91 journals |

`download` does a depth-1, blob-less, sparse fetch of `pages/ journals/ logseq/ whiteboards/` plus top-level files. Images, gifs and screenshots are skipped (the full repo is about 1.2 GB). Running it again is a no-op when the pinned commit is already checked out.
