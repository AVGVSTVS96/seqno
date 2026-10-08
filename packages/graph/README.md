# @seqno/graph

The Loro CRDT graph that is the source of truth for pages and blocks: on the core side, it opens from edit-log bytes, applies every `Command` with undo and redo, and reports changes as `GraphEvent`s.

## What's inside

| Export                                  | What it does                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Graph`                                 | Effect service: `pages`, `page`, `block`, `dispatch`, `dispatchAll`, `merge`, `load`, `events`, `flush`, `snapshot`, `version`, `loaded`. |
| `Graph.layer(source)`                   | Opens from a snapshot and update files and reads the page list, then records block ids one page per tick; `loaded` completes after.       |
| `vaultReplica(graph)`                   | Adapts a `Graph` to `@seqno/vault`'s `Replica`, so the vault can sync it.                                                                 |
| `PeerId`, `LocalUpdate`, `ImportFailed` | The Loro peer id a device writes with, a run of local ops ready to save, and bytes Loro refused.                                          |

- Events come only from Loro's change feed, so local edits, undo, redo, loads and merged remote ops all produce the same `GraphEvent`s.
- `flush(write)` exports this peer's ops since the last save and moves its mark only if `write` succeeds.
- `load(pages)` adds imported pages with their given ids, journal days and props, outside the undo history.
- Undo follows Logseq: typing and property edits in one block form one step, every other command is its own step, and remote ops are never undone.
- Layout: one Loro tree with pages as roots and blocks below them. Text is a `LoroText`; props are a `LoroMap` plus a key list that keeps their order.

## Tests

```sh
pnpm test --project @seqno/graph
```

## Known gaps

- There is no `eventsSince(version)`, so a stale index has to rebuild from every page.
- Two devices creating the same page name at once get two pages; nothing merges them.
- Undoing a delete re-creates the blocks with the same ids, but edits another device made to them in the meantime are lost.
