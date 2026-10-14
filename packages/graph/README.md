# @seqno/graph

The Loro CRDT graph that is the source of truth for pages and blocks: on the core side, it opens from edit-log bytes, applies every `Command` with undo and redo, and reports changes as `GraphEvent`s.

## What's inside

| Export                                               | What it does                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Graph`                                              | Effect service: `pages`, `page`, `block`, `dispatch`, `dispatchAll`, `merge`, `load`, `seed`, `events`, `flush`, `snapshot`, `version`, `changedSince`, `loaded`. |
| `Graph.layer(source)`                                | Opens from a snapshot and update files and reads the page list, then records block ids one page per tick; `loaded` completes after.                               |
| `vaultReplica(graph)`                                | Adapts a `Graph` to `@seqno/vault`'s `Replica`, so the vault can sync it.                                                                                         |
| `PeerId`, `newPeerId`, `LocalUpdate`, `ImportFailed` | The Loro peer id a session writes with and a fresh random one, a run of local ops ready to save, and bytes Loro refused.                                          |
| `graphV2Layer(source)`                               | The same `Graph` service on the second layout, one Loro tree per page (below). Graphs kept in the browser use it.                                                 |
| `convertOneTree(files)`                              | Converts a graph saved in the one-tree layout to a snapshot of the tree-per-page layout, the same bytes on every device for the same files.                       |
| `compareConverted(oneTree, treePerPage)`             | Opens both and compares every page's events, journals under their day's id; names the pages that differ. The app checks a conversion with it before it commits.   |
| `journalPageId(day)`                                 | The page id of a day's journal in the tree-per-page layout: `0000YYYY-MMDD-7000-8000-000000000000`, so every device's "today" is one page and one tree.           |
| `journalsByDay(pages)`                               | Gives each day's first journal among `pages` its `journalPageId`, the converter's rule, for pages on their way into the tree-per-page layout.                     |

- Events come only from Loro's change feed, so local edits, undo, redo, loads and merged remote ops all produce the same `GraphEvent`s.
- `flush(write)` exports this peer's ops since the last save and moves its mark only if `write` succeeds.
- `restore(updates)` imports into an empty graph without events (merging same-named pages) and returns the version the import reached, before that merge; `everything` streams the whole state as events, one batch per page, to fill an index from. On a graph that already holds ops, `restore` merges. A restore that imports nothing leaves the graph as it was.
- `changedSince(version)` names the pages touched since `version` (by Loro's `findIdSpansBetween` and `getChangedContainersIn`, plus the targets of tree moves) and the blocks among them, whose earlier pages only an index knows. It is `None` when the graph doesn't hold `version`.
- `load(pages)` adds imported pages with their given ids, journal days and props, outside the undo history.
- `seed(pages)` does the same on an empty graph, but writes the ops under a peer id hashed from the pages and with times taken from them (noon UTC of the latest journal day), and returns those ops as their own update. Two devices seeding the same pages write identical ops, so merging one into the other adds nothing.
- Two live pages with one name merge into the one with the smaller id right after the commit or merge that made them; the other stays as a hidden root marked `mergedInto`, and blocks that land there later move over too.
- `MergeWithPrevious` appends the block's text to the previous visible block, moves its children there, and fills that block's missing properties from it. `mergeTarget(id)` names that block, so the core can point `((refs))` to the merged block at the one it merged into in the same commit.
- Deleting blocks or a page (and the block a merge empties) moves them under a hidden trash root instead of deleting them in Loro, so undo moves the same nodes back, with whatever other devices typed into them meanwhile. Undoing an insert moves the new block there too, and redo moves it back. Reads and events treat the trash as deleted.
- Undo follows Logseq: typing and property edits in one block form one step, every other command is its own step, and remote ops are never undone. `dispatch` and `dispatchAll` take an optional client id: each client gets its own undo and redo stacks (100 steps each), which never take back another client's edits, and `release(client)` drops them.
- Undo is the graph's own (`history.ts`), not Loro's `UndoManager`: every command records its inverse as it runs (a text delta, "move to the trash", the old place of a moved node, the old value of a property or field), and undo applies it through the same recorder, which records the redo. It never checks out an old version, so it costs the same however long the history is. Text inverses are rebased on every change to their block (`delta.ts`), so undo never removes another client's or device's characters; a step whose property or block someone else changed after it leaves that part alone. A rejected `dispatchAll` is rolled back.
- Layout: one Loro tree with pages as roots and blocks below them. Text is a `LoroText`; props are a `LoroMap` plus a key list that keeps their order.

## The tree-per-page layout (`graphV2Layer`)

Graphs kept in the browser use it; picked folders stay on the one-tree layout. Everything the `Graph` service promises holds on both, and the test suite runs on both (`@seqno/graph` and `@seqno/graph v2`).

- **Directory.** Flat maps keyed by page id: `titles` (a page exists while it has a title), `days`, `trashed` and `mergedInto`. Page properties live in `pageData`, one mergeable map per page that has any. Listing the pages reads only these maps, never a tree.
- **Blocks.** Each page has its own tree, `blocks:<pageId>`, with its top-level blocks as roots and one hidden trash root. A block's content (text, props, times) is the data map of its home node.
- **Moves between pages are pointer moves.** The block's home node, with its whole subtree, stays where it is; the target page gets a pointer node, and the block's `at` key names it. `at` is the one place that says where a block shows: a node shows only if it is its block's placement, so two devices moving one block to two pages resolve like Loro's own concurrent moves, by the last writer of `at`, with no repair. Text typed meanwhile and children added meanwhile live on the home node and show at the new place. Moving a block back to its home page moves the home node and drops the pointer.
- **Repair** looks only at what changed: same-name pages among the pages a change touched, and, once any block has moved between pages, cycles among the nodes a change touched (two devices moving two blocks under each other across pages). A cycle is cut at the block with the smallest id, which goes back to the top of its home page. On a restore it checks only the blocks listed in `moved`.
- **Same-name pages merge through the directory**: `mergedInto[loser] = winner` and the winner's page shows the loser's tree after its own. Nothing moves, so blocks a device adds to the merged-away page later show up too.
- **Journals** written with `journalPageId(day)` land in one tree on every device; the converter gives each day's journal that id, and `journalsByDay` does the same for imported or new pages. `load` and `seed` keep whatever ids they are given.
- **Undo** uses the same recorder per page tree; a move between pages records the new pointer, the old placement going to the trash and the old `at`, so undo puts the block back with what other devices typed into it.
- **Events** compare each touched block's place with the last place this session reported, so a page restored from the trash, merged into another or moved under a pointer reports exactly the blocks that changed.
- **Reads per node stay fixed.** Every Loro read is a call into wasm (a map `get` costs 4 to 8 µs on a 20k-block page), so bulk commands read each node a fixed number of times: `uuid`, `ref` and `trash`, written once when a node is made, are read once and kept by spot key; `at` is read only for homes listed in `moved`, which a JS set mirrors; a page's sibling list takes the blocks this session already read from what it knows; and a block is looked up among its siblings starting at its Loro index.

## Tests

```sh
pnpm test --project @seqno/graph
```

## Known gaps

- On the one-tree layout, Loro reports a move only as a change to the whole tree, so `changedSince` reads the ops of every change that moved a node to find which ones.
- Undo is exact for one client's own history. When another client or device edited the same block between a step and its undo, text positions come from rebasing alone: text put back next to someone else's insert at the same spot can land on the other side of it, and a character this client typed, deleted and got back by undoing the delete can survive undoing the typing. Loro's own undo has the same limits.
- Tree-per-page layout: a page that shows blocks moved in from a long page reads that page's tree when first opened.
- Tree-per-page layout: moving a block between pages wins over a delete, indent or move of the same block made meanwhile on another device. Loro's own tree would pick the later of the two.
