# @seqno/graph

The Loro CRDT graph that is the source of truth for pages and blocks: on the core side, it opens from edit-log bytes, applies every `Command` with undo and redo, and reports changes as `GraphEvent`s.

## What's inside

| Export                                               | What it does                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Graph`                                              | Effect service: `pages`, `page`, `block`, `dispatch`, `dispatchAll`, `merge`, `load`, `seed`, `events`, `flush`, `snapshot`, `version`, `loaded`. |
| `Graph.layer(source)`                                | Opens from a snapshot and update files and reads the page list, then records block ids one page per tick; `loaded` completes after.               |
| `vaultReplica(graph)`                                | Adapts a `Graph` to `@seqno/vault`'s `Replica`, so the vault can sync it.                                                                         |
| `PeerId`, `newPeerId`, `LocalUpdate`, `ImportFailed` | The Loro peer id a session writes with and a fresh random one, a run of local ops ready to save, and bytes Loro refused.                          |

- Events come only from Loro's change feed, so local edits, undo, redo, loads and merged remote ops all produce the same `GraphEvent`s.
- `flush(write)` exports this peer's ops since the last save and moves its mark only if `write` succeeds.
- `restore(updates)` imports into an empty graph without events (merging same-named pages), and `everything` streams the whole state as events, one batch per page, to fill an index from. On a graph that already holds ops, `restore` merges.
- `load(pages)` adds imported pages with their given ids, journal days and props, outside the undo history.
- `seed(pages)` does the same on an empty graph, but writes the ops under a peer id hashed from the pages and with times taken from them (noon UTC of the latest journal day), and returns those ops as their own update. Two devices seeding the same pages write identical ops, so merging one into the other adds nothing.
- Two live pages with one name merge into the one with the smaller id right after the commit or merge that made them; the other stays as a hidden root marked `mergedInto`, and blocks that land there later move over too.
- `MergeWithPrevious` appends the block's text to the previous visible block, moves its children there, and fills that block's missing properties from it. `mergeTarget(id)` names that block, so the core can point `((refs))` to the merged block at the one it merged into in the same commit.
- Deleting blocks or a page (and the block a merge empties) moves them under a hidden trash root instead of deleting them in Loro, so undo moves the same nodes back, with whatever other devices typed into them meanwhile. Undoing an insert moves the new block there too, and redo moves it back. Reads and events treat the trash as deleted.
- Undo follows Logseq: typing and property edits in one block form one step, every other command is its own step, and remote ops are never undone. `dispatch` and `dispatchAll` take an optional client id: each client gets its own undo and redo stacks (100 steps each), which never take back another client's edits, and `release(client)` drops them.
- Undo is the graph's own (`history.ts`), not Loro's `UndoManager`: every command records its inverse as it runs (a text delta, "move to the trash", the old place of a moved node, the old value of a property or field), and undo applies it through the same recorder, which records the redo. It never checks out an old version, so it costs the same however long the history is. Text inverses are rebased on every change to their block (`delta.ts`), so undo never removes another client's or device's characters; a step whose property or block someone else changed after it leaves that part alone. A rejected `dispatchAll` is rolled back.
- Layout: one Loro tree with pages as roots and blocks below them. Text is a `LoroText`; props are a `LoroMap` plus a key list that keeps their order.

## Tests

```sh
pnpm test --project @seqno/graph
```

## Known gaps

- There is no `eventsSince(version)`, so a stale index has to rebuild from every page.
- Undo is exact for one client's own history. When another client or device edited the same block between a step and its undo, text positions come from rebasing alone: text put back next to someone else's insert at the same spot can land on the other side of it, and a character this client typed, deleted and got back by undoing the delete can survive undoing the typing. Loro's own undo has the same limits.
- Deleting thousands of blocks from one page at once is slow (5,000 of a 20k-block page take about 16 s); that cost is in the command, not in undo.
