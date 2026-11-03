# @seqno/interop

The core side's bridge to Logseq: it imports a Logseq file-based graph folder as pages and blocks, and writes pages back out as Logseq markdown and whiteboards as Logseq's whiteboard EDN files.

## What's inside

| Export                                                        | What it does                                                                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importGraph`                                                 | Reads `logseq/config.edn`, `journals/`, `pages/` and `whiteboards/` into `ImportedGraph { config, pages, issues }`. Pages are `PageTree`s ready for `Graph.load`. |
| `ImportIssue`                                                 | Why a file was skipped or flagged: `NotDownloaded` (an iCloud placeholder), `Unreadable`, `Unsupported`, `DuplicatePage`, `DuplicateBlockId`.                     |
| `renderMirror`, `writeMirror`, `mirrorPath`                   | Pages to Logseq files (a whiteboard to `whiteboards/<title>.edn`). Only the designated device writes, and only files whose content changed.                       |
| `readWhiteboard`, `whiteboardBlocks`, `renderWhiteboard`      | One whiteboard file to a page's props and blocks, and back.                                                                                                       |
| `readEdn`, `printEdn`, `Edn`                                  | An EDN reader, and a printer that lays files out as Logseq writes them (ClojureScript's map order included).                                                      |
| `GraphFolder`, `layerFileSystem(root)`                        | The folder port (`list`, `read`, `write`, `remove`) and a node implementation.                                                                                    |
| `LogseqSyntax`, `LogseqSyntaxLive`                            | Parse and print through `@seqno/syntax`, moving each block's `key:: value` lines into `props`.                                                                    |
| `LogseqConfig`, `parseConfig`, `printConfig`, `defaultConfig` | The parts of `config.edn` that import and mirror need, `:whiteboards-directory` included.                                                                         |
| `fileBodyFromTitle`, `titleFromFileBody`                      | Logseq's file name rules (`___` for `/`, percent-encoded reserved characters) as a strict inverse pair.                                                           |
| `formatJournalDay`, `parseJournalDay`                         | Journal file names and titles in every date format Logseq's settings offer.                                                                                       |

- Ids are a function of the folder: every id that isn't kept from an `id::` comes from a generator seeded with a hash of `config.edn` and every imported file, so the same files always give the same ids.
- Block `id::` values that are UUIDv7 become the `BlockId`; any other id stays in `props.id`, and the mirror writes it back.
- Importing a canonical Logseq graph and rendering the mirror gives back the same bytes.

## Whiteboards

A Logseq whiteboard is one EDN file, `{:blocks (...) :pages ({...})}`: one map per shape, the page map holding the tldraw page (`logseq.tldraw.page`: bindings, assets, shape order), and any plain blocks the board holds. seqno keeps the model in `@seqno/domain`'s `whiteboard.ts`: the board is a page with `ls-type:: whiteboard-page`, each shape a top-level block with `ls-type` and `logseq.tldraw.shape` (the shape's JSON), block order is z-order.

- Import orders shapes by their `index`, as Logseq does, and puts the board's plain blocks after them as an outline (`:block/parent` and `:block/left`).
- A shape's words move into its block's text: a text shape's `text`, a box, ellipse, polygon or connector's `label`, a portal's `pageId` as `[[page]]` (`blockType` `P`) or `((uuid))` (`B`). The mirror puts them back.
- A connector handle's `bindingId` is looked up in the page's `bindings`, and the handle gets `bindTo`: the seqno id of the shape it's bound to. Writing, a handle whose binding still points at that shape keeps its binding; a new or moved one gets a new binding (`point [0.5 0.5]`, `distance 4`, Logseq's defaults). Bindings between shapes that both still exist are kept, as Logseq keeps them.
- A shape written without a `nonce` gets `nonce 1`: in Logseq a connector doesn't follow a shape that has none, and Logseq writes `##NaN` for it, which the reader and printer also handle.
- An image's `assetId` is looked up in the page's `assets`, and the shape gets the asset's `src`. Writing moves `src` back into `assets`, adding an asset for an image drawn in seqno.
- Shape and block ids follow the markdown rule (UUIDv7 kept, any other id in `props.id`); `created-at` and `updated-at` become props of the same name; `logseq.tldraw.page` keeps the tldraw page, and `logseq.whiteboard.fields` keeps page fields seqno has no place for (`:block/journal?`, `:block/format`, `:block/namespace`) as EDN.
- The mirror prints the file as Logseq's `ugly-pr-str` does: maps of more than eight keys in ClojureScript's hash order, smaller ones in the order Logseq builds them, blocks' keys alphabetically as Datascript pulls them.

Opened in Logseq 0.10.9's desktop app, boards seqno wrote (logseq/docs' board, the portal board, and one drawn in seqno with a box, an ellipse, text, a page portal, a block portal and a bound connector) load, render every shape and portal, and stay unchanged on disk; dragging the box moves the connector with it, and the file Logseq then writes imports back with the same ids and bindings.

On 61 real boards (logseq/docs' Test Whiteboard and 60 from public GitHub graphs) import then mirror writes all 948 shapes and 58 of 61 page maps back byte for byte, and 211 of 324 plain blocks. The rest:

- 89 plain blocks gain `:block/properties {}` where Logseq left the key out; Logseq reads both as no properties.
- 14 plain blocks get a repaired `:block/left` where Logseq's chain was broken (two blocks claiming the same left, or a left that was deleted).
- 10 plain blocks lose an `id::` line from their content. Logseq keeps the block's id in `:block/uuid`, and most boards never write the line.
- 1 page map gains `:block/original-name`, which Logseq fills in when it loads a board; 2 boards Logseq left without whiteboard props gain `ls-type` and an empty tldraw page.
- Blocks are written shapes first, in z-order, where Logseq writes them in Datascript's order, so a whole file is the same blocks in a different order.

## Tests

```sh
pnpm test --project @seqno/interop
```

## Known gaps

- Org-mode files and `assets/` are not imported; `.org` files are reported as `Unsupported`, as is anything but `.edn` in `whiteboards/`.
- A board's file is named after its title, so a board whose file name differs from its `:block/original-name` moves to a new file.
- seqno's blocks carry no edit times, so a shape or board made in seqno is written without `:block/created-at` and `:block/updated-at`, and editing a Logseq shape keeps its old ones.
- Groups keep their `children` as Logseq ids, which stay right only while the grouped shapes keep theirs.
- Import is one-time. Running it again on changed files gives a whole new set of ids.
- The mirror writes two pages on the same journal day to the same file, and doesn't shorten names over 255 bytes.
