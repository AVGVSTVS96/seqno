# @seqno/domain

The pure, shared contract every package codes against: Effect Schemas for pages, blocks, commands and graph events, plus branded ids.

## What's inside

| Export                                    | What it is                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `BlockId`, `PageId`                       | Branded UUIDv7 strings. Mint them with `newBlockId` / `newPageId`, which need Effect's `Crypto` service.                      |
| `DeviceId`                                | Branded 1-64 characters of `[A-Za-z0-9_-]`, safe in file names.                                                               |
| `Block`, `Page`, `Props`                  | A block (`id`, `pageId`, `parentId`, `text`, `collapsed`, `props`) and a page (`id`, `name`, `title`, `journalDay`, `props`). |
| `PageName`, `normalizePageName`           | Page names are NFC, trimmed and lowercase; a `Page` whose `name` isn't fails to decode.                                       |
| `JournalDay`                              | A real calendar day as `YYYYMMDD`.                                                                                            |
| `Command`, `BlockDraft`, `PropertyTarget` | Every edit the core accepts, from `CreatePage` to `Undo` / `Redo`. `InsertBlocks` takes a tree of `BlockDraft`s.              |
| `GraphEvent`                              | What changed: `PageUpserted`, `PageDeleted`, `BlockUpserted`, `BlockMoved`, `BlockDeleted`.                                   |

- It imports no other `@seqno` package, and every other package may import it.
- Sibling order is not a field on `Block`; it comes from the graph's tree.
- Commands carry no new ids. The core mints them, and callers learn them from the returned `GraphEvent`s.
- `EditText` offsets are UTF-16 code units, the same units CodeMirror and Loro use.

## Tests

```sh
pnpm test --project @seqno/domain
```

## Known gaps

- `BlockId` accepts UUIDv7 only. Logseq's `id::` values are v4, so imported blocks get new v7 ids and keep the original in `props.id`.
- `MoveBlocks` has no `pageId`. With `parentId: null` the target page comes from `after` or the blocks' current page, so blocks can't move to the top level of an empty page.
