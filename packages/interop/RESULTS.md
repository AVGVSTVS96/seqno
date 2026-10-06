# interop results (phase 1)

## What works

```
Logseq folder ──GraphFolder.list/read──> importGraph ──> ImportedGraph { config, pages: PageTree[], issues }
                                             │
                                     LogseqSyntax.parse   (stand-in for @seqno/syntax)

PageTree[] ──renderMirror──> Map<path, markdown> ──writeMirror──> GraphFolder.write/remove
                 │                                     (designated device only, changed files only)
         LogseqSyntax.print
```

- **Import** (`importGraph`): reads `logseq/config.edn`, `journals/` and `pages/` (or the configured `:journals-directory` / `:pages-directory`), skips `:hidden` folders and dotfiles, and returns `PageTree`s (the `@seqno/rpc` shape: `{ page, blocks }`, blocks in depth-first pre-order) plus a list of issues.
  - Journal file names are parsed with `:journal/file-name-format` (falls back to `yyyy_MM_dd`). Titles use `:journal/page-title-format`. Supported tokens: `yyyy MMMM MMM MM M do dd d EEEE EEE EE E 'quoted'`. That covers every format in Logseq's settings menu.
  - Page file names: the `:triple-lowbar` format (`a___b.md` is `a/b`, percent-encoding decoded) and the legacy format (`a.b.md` is `a/b`). Names are NFC-normalized when read. A `title::` page property wins over the file name.
  - Block `id::` values are kept: a UUIDv7 becomes the `BlockId`; any other id stays in `props.id` (see the contract gap below). Duplicate ids are reported.
  - Unknown syntax stays verbatim in `Block.text` (macros, embeds, `:LOGBOOK:` drawers, `#+BEGIN_` blocks, fenced code with `- ` lines inside).
  - Issues (`ImportIssue`, a `_tag` union): `NotDownloaded` (an iCloud `.name.md.icloud` placeholder: reported, never imported as an empty page), `Unreadable`, `Unsupported` (`.org` and other non-markdown files), `DuplicatePage`, `DuplicateBlockId`.
- **Mirror** (`renderMirror`, `writeMirror`): graph to Logseq markdown files.
  - Only the designated writer writes. Any other device gets `NotWriter` and touches nothing.
  - It writes only files whose content changed, removes the `.md` files of deleted pages, and writes `logseq/config.edn` with `:file/name-format :triple-lowbar` if there is none. Logseq needs that key to read `___` names correctly.
  - It removes files before it writes them. On a case-insensitive disk, renaming `foo` to `Foo` would otherwise delete the new file.
  - It compares listed names after NFC normalization, so an NFD name (macOS Foundation writes NFD) counts as the same page and is not deleted.
  - It adds an `id::` line to any block that another block references with `((uuid))` (in its text or its props), the way Logseq does.
  - It writes no file for a page that has no blocks and no props, which matches Logseq.
  - Writes go through `GraphFolder.write`, which must be atomic. The node-fs layer writes a temp file, then renames it.
- **File name codec** (`fileBodyFromTitle` / `titleFromFileBody`): a strict inverse pair. It follows Logseq's rules (reserved chars `: * ? " < > | # \` are percent-encoded, `/` becomes `___`, a literal `___` becomes `%5F%5F%5F`, Windows names like `CON` get a guard suffix) and fixes two ambiguities Logseq has: an `_` just before a `/` (`a_/b`) and a leading `.`.
- **Round trip**: import a canonical Logseq graph, then render the mirror, and you get the same bytes (this is tested).

## Interfaces added inside this package (for integration)

- `LogseqSyntax` (`Context.Service`): `parse(source) => Outline` and `print(Outline) => string`. `Outline = { props, blocks: OutlineBlock[] }` and `OutlineBlock = { text, props, collapsed, children }`. `LogseqSyntaxLive` is a small stand-in parser. **Integration swaps in `@seqno/syntax` by giving it a layer for this service.**
- `GraphFolder` (`Context.Service`): `list` (relative POSIX paths, recursive), `read`, `write` (atomic, creates parent folders), `remove`. `layerFileSystem(root)` builds it on Effect's `FileSystem` and `Path` (node). The vault's File System Access and OPFS adapters need a few lines each to provide it.
- `LogseqConfig` (Schema), `parseConfig`, `printConfig`, `defaultConfig`.
- `ImportedGraph`, `ImportIssue`, `MirrorOutcome` are Schemas, so they can cross the worker boundary.

## Contract gaps to reconcile

1. **`BlockId` is UUIDv7-only, and Logseq's `id::` values are v4.** Import keeps the v4 string in `props.id` and mints a v7 `BlockId`. `((v4-uuid))` refs in text stay as written, and the mirror writes `id::` back, so Logseq still resolves them. Inside seqno, the index has to resolve `((uuid))` through `props.id`, or `BlockId` has to accept any UUID. The second option is simpler.
2. **Commands carry no ids**, so import can't be a list of `Command`s without losing `id::` values. It returns a populated graph (`PageTree[]`) instead. `@seqno/graph` needs a bulk-load entry point that takes `PageTree[]` with ids as given.
3. **Where props live.** Import puts Logseq properties (the `key:: value` lines right after a block's first line) in `Block.props`, not in `Block.text`. `collapsed:: true` becomes `Block.collapsed`. `id::` stays in `props.id` so its line position survives. The spike index parsed props out of `text`, so the index and graph should agree on this split.
4. **Pages that exist only as references** (`[[x]]` with no file) are not created by import. Whoever owns refs (graph or index) decides.

## How to run the tests

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 npx vitest run --project @seqno/interop
```

There are 18 tests in `test/names.test.ts`, `test/outline.test.ts` and `test/graph.test.ts`. The graph tests build a real Logseq folder in a temp dir and run import and mirror against it through `layerFileSystem` and `NodeFileSystem`. Lint, `oxfmt --check` and `tsc --noEmit` are clean for this package.

`pnpm-lock.yaml` is not committed (it is a root file). Run `pnpm install` once after merging to add `@seqno/interop` and `@effect/platform-node` (a dev dependency, used for tests only).

## Known gaps

- The stand-in parser's exact round trip covers canonical Logseq output: tab indentation, `- ` bullets, page props followed by one blank line, no trailing newline. It parses 2-space indentation but prints tabs. `collapsed:: true` is printed as the last property. Leading non-property text above the first bullet becomes the first block. `@seqno/syntax` should own exactness.
- Block property extraction stops at the first line that is not canonical (`key:: value` with exactly one space), at a duplicate key, at a numeric key (JS objects would reorder it), and after a fence or `#+BEGIN_` opener. Those lines stay in `text`, so nothing is lost.
- Org-mode files, whiteboards (`.edn`) and `assets/` are not imported. Org files are reported as `Unsupported`.
- Re-importing mints new page ids and new ids for blocks without `id::`. Import is a one-time step, not a sync.
- Mirror: if two pages share a journal day, the second overwrites the first file. Over-long file names (more than 255 bytes) are not shortened.
- The mirror leaves an evicted iCloud placeholder of a stale page alone. That page gets removed on a later run, after it downloads.
