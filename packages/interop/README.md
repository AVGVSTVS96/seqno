# @seqno/interop

The core side's bridge to Logseq: it imports a Logseq file-based graph folder as pages and blocks, and writes pages back out as Logseq markdown.

## What's inside

| Export                                                        | What it does                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importGraph`                                                 | Reads `logseq/config.edn`, `journals/` and `pages/` into `ImportedGraph { config, pages, issues }`. Pages are `PageTree`s ready for `Graph.load`. |
| `ImportIssue`                                                 | Why a file was skipped or flagged: `NotDownloaded` (an iCloud placeholder), `Unreadable`, `Unsupported`, `DuplicatePage`, `DuplicateBlockId`.     |
| `renderMirror`, `writeMirror`, `mirrorPath`                   | Pages to Logseq files. Only the designated device writes, and only files whose content changed.                                                   |
| `GraphFolder`, `layerFileSystem(root)`                        | The folder port (`list`, `read`, `write`, `remove`) and a node implementation.                                                                    |
| `LogseqSyntax`, `LogseqSyntaxLive`                            | Parse and print through `@seqno/syntax`, moving each block's `key:: value` lines into `props`.                                                    |
| `LogseqConfig`, `parseConfig`, `printConfig`, `defaultConfig` | The parts of `config.edn` that import and mirror need.                                                                                            |
| `fileBodyFromTitle`, `titleFromFileBody`                      | Logseq's file name rules (`___` for `/`, percent-encoded reserved characters) as a strict inverse pair.                                           |
| `formatJournalDay`, `parseJournalDay`                         | Journal file names and titles in every date format Logseq's settings offer.                                                                       |

- Block `id::` values that are UUIDv7 become the `BlockId`; any other id stays in `props.id`, and the mirror writes it back.
- Importing a canonical Logseq graph and rendering the mirror gives back the same bytes.

## Tests

```sh
pnpm test --project @seqno/interop
```

## Known gaps

- Org-mode files, whiteboards and `assets/` are not imported; `.org` files are reported as `Unsupported`.
- Import is one-time: running it again mints new ids for pages and for blocks without a UUIDv7 `id::`.
- The mirror writes two pages on the same journal day to the same file, and doesn't shorten names over 255 bytes.
