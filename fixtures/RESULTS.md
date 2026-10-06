# fixtures: phase 1 results

## What works

- **Generator port**: `src/generator` is the phase 0 generator. The default graph digest (`5405c909c0dd19e2`) and the 10k-edit digest (`a9197d2c91dfba7c`) are unchanged.
- **OG markdown writer**: `toLogseqFiles` writes any generated graph as a Logseq OG folder. The CLI writes the 50k graph as 1,866 files.
- **Logseq's own random graph generator, ported**: `ogGeneratedGraph(seed)` is byte-identical to upstream for seeds 1309, 42 and 8675309. I checked this by running the upstream ClojureScript (`exporter_test.cljs`, lines 266-406) under nbb 1.3.204 and diffing every file. The tests pin hashes of that upstream output.
- **Edge cases**: 15 cases cover all 13 headings in `og_import_graph_cases.md`, plus `og-syntax-mix`. 12 are committed folders; 3 are generated on demand.
- **Download**: `node src/cli.ts download` fetched logseq/docs at the pinned commit in a few seconds (6.7 MB, 242 pages, 91 journals). It also checks that the license is still MIT.
- **CLI**: `generate`, `stats`, `edge-case`, `download`, built on `effect/cli` with `NodeServices`.

## How to run

```sh
cd fixtures
pnpm install
pnpm test          # vitest: 20 tests, about 3 s
pnpm typecheck     # tsc 7, clean
pnpm download      # needs network; fills fixtures/downloads/ (gitignored)
```

## Changes to the shared contract

- Generated types are named `GeneratedGraph`, `GeneratedPage`, `GeneratedBlock` and `GeneratorOptions`, so they don't clash with `@seqno/domain`'s `Block` and `Page`. `GeneratedBlock.text` matches `Block.text`. Props stay inline as `key:: value`, which is how the markdown stores them.
- Generator ids are UUID v4-shaped, not v7, to keep the phase 0 digests. Imported Logseq graphs also carry v4 `id::` values, so `BlockId` should accept any UUID, not only v7.
- Edits changed from `kind: "insertText"` to `_tag: "InsertText"` (code rules). Phase 0 spikes used `kind`.

## Known gaps

- **Workspace**: there is no root `pnpm-workspace.yaml` yet, so I installed `fixtures/` on its own. Its local `pnpm-lock.yaml` and `pnpm-workspace.yaml` are gitignored. Integration should add `fixtures` to the root workspace.
- **Lint and format**: oxlint and oxfmt were not run; the root config doesn't exist yet.
- **Expectations are prose**: the edge-case `expect` strings (`src/cases.ts`) describe Logseq's import behaviour. The interop package's tests have to turn them into assertions.
- **Placeholder files**: the area-highlight `.png` is a 4-byte placeholder, as in upstream's test. External PDFs are deliberately absent.
- **NFD file name**: `og-syntax-mix/pages/Café NFD.md` is stored NFD in git. On macOS with `core.precomposeunicode=true` it checks out as NFC, so the edge only exists on Linux checkouts.
- **Upstream generator check**: the comparison against upstream was run once by hand (nbb is not a dependency). The pinned hashes guard against drift in our port, not against upstream changing its generator.
