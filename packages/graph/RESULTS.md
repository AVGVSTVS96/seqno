# graph results (phase 1)

`@seqno/graph` is the Loro-backed graph: open lazily from vault bytes, apply every `Command`, undo/redo, turn Loro change events into `GraphEvent`s, and hand local ops to the vault.

## What works

- **`Graph` service + `Graph.layer(source)`** (`Context.Service`, needs `Crypto` to mint ids).
- **Lazy open**: the layer imports the snapshot, then each update file one at a time (the fastest path in `spikes/web-perf`). After that it reads only the page list. `page(id)` reads one page. A scoped background fiber records every block id behind it, one page per tick, and `loaded` completes when it is done.
- **Commands**: all 15 from the contract.
- **Events from Loro, nowhere else.** One `doc.subscribe` collects event batches. After each commit, undo, redo or merge, the batches become `GraphEvent`s. `dispatch` and `merge` return those events, and the same events go out on `events`.
- **Undo/redo**: Loro `UndoManager`. Remote ops are never undone.
- **Persistence**: `flush(write)` exports this peer's ops since the last flush and moves its mark forward only if `write` succeeds. After a reopen, the counter continues where the files left off. `snapshot` and `version` are there for compaction and `seen/<device>.json`.
- **Two-device merge**: concurrent text edits, indent, insert, delete and property writes from two docs end up with identical page trees and version vectors.

```ts
class Graph {
  pages: Effect<ReadonlyArray<Page>>
  page: (id: PageId) => Effect<PageTree, PageNotFound>
  block: (id: BlockId) => Effect<Block, BlockNotFound>
  dispatch: (command: Command) => Effect<ReadonlyArray<GraphEvent>, CommandRejected>
  dispatchAll: (
    commands: ReadonlyArray<Command>,
  ) => Effect<ReadonlyArray<GraphEvent>, CommandRejected> // one commit, one undo step
  merge: (updates: ReadonlyArray<Uint8Array>) => Effect<ReadonlyArray<GraphEvent>, ImportFailed>
  events: Stream<GraphEvent>
  flush: (write: (u: LocalUpdate) => Effect<void, E, R>) => Effect<Option<LocalUpdate>, E, R>
  snapshot: Effect<Uint8Array>
  version: Effect<ReadonlyMap<string, number>>
  loaded: Effect<void>
}
Graph.layer({ peer, snapshot: Option<Uint8Array>, updates })
```

`PageTree`, `CommandRejected`, `PageNotFound` and `BlockNotFound` come from `@seqno/rpc`, so the worker's `Dispatch`, `GetPage` and `GetBlock` handlers can pass results straight through.

## Loro layout

```
tree "blocks"
  root node = page   { uuid: PageId, title, journalDay?, props: mergeable LoroMap }
  child node = block { uuid: BlockId, text: mergeable LoroText, props: mergeable LoroMap,
                       collapsed?, created, updated }
```

- Every node read is decoded with Schema. A malformed node from another peer gets skipped instead of crashing.
- Text and props use `ensureMergeableText` / `ensureMergeableMap`. If two peers create the container at the same time, they get the same container and their edits merge.
- Sibling order comes from the tree's fractional index.

## Command semantics (Logseq defaults)

| Command                     | Behavior                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `InsertBlock`               | no `after` means first child; `after` must be a child of the target parent                                                                                                                 |
| `SplitBlock`                | the text after `at` becomes the next sibling, or the first child if the block has expanded children. `at = 0` on a non-empty block inserts an empty block above, so the block keeps its id |
| `MergeWithPrevious`         | appends to the previous visible block (the deepest last expanded descendant of the previous sibling, or the parent). Children move to the parent in place, or under the target             |
| `Indent`                    | each selected root goes under its previous sibling, in document order                                                                                                                      |
| `Outdent`                   | Logseq's default (non-logical) outdent: the block goes after its parent and adopts its following siblings                                                                                  |
| `MoveBlocks`                | `parentId: null` means the top level of `after`'s page, or of the first block's page                                                                                                       |
| `CreatePage` / `RenamePage` | reject empty names and names already in use                                                                                                                                                |
| `Undo` / `Redo`             | do nothing and return `[]` when the stack is empty                                                                                                                                         |

Selections are reduced to their top-most blocks and sorted into document order. Every command validates before it changes anything, so a rejected command leaves no ops behind.

## Additions to the contract (for integration)

- `PeerId`: a branded decimal string, the Loro peer id. It has to be **stable per device**, because update files are named by op counter (`updates/<deviceId>/<start>.loro`), and **unique per running instance**. On web, two tabs need Web Locks. The vault/device layer owns minting and storing it.
- `LocalUpdate { peer, start, end, bytes }`: `start` is the file name the vault writes.
- `ImportFailed { reason }`: bytes Loro refuses to import. This happens at open (the layer fails) or in `merge`.
- `BlockUpserted.createdAt` / `updatedAt` come from the `created` / `updated` keys on the node. They are CRDT state, so every device agrees. `updated` is stamped through Effect `Clock` on text, property and split/merge edits.

## How to run

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 node_modules/.bin/vitest run --project @seqno/graph
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm check
```

There are 22 tests in `test/commands.test.ts` (every command, the rejections, undo/redo, the event stream) and `test/sync.test.ts` (two-device convergence, concurrent props, flush/reopen, lazy open). `pnpm check` passes for the whole repo.

## Known gaps

- **`journalDay` is never set.** `CreatePage` has only `title`, and guessing a date from a title depends on the format. Journals need a `journalDay` field on `CreatePage`, or a `CreateJournal` command.
- **Index catch-up after a restart.** The graph exposes `version`, but there's no `eventsSince(version)` yet (Loro's `doc.diff(from, to)` would fit). Today a stale index has to rebuild by reading every page.
- **Merges can emit extra events.** Importing concurrent ops makes Loro re-emit some unchanged nodes. Those turn into idempotent `BlockUpserted` / `BlockMoved` events. Deletes are checked against the live tree, so a re-created node never shows up as deleted.
- **Undoing a delete re-creates nodes** with the same `uuid` (Loro's `UndoManager` behavior). The registry follows the uuid, so ids stay stable. Edits another device made to the old node at the same time are lost.
- **`MergeWithPrevious` drops the merged block's own properties**, as Logseq does.
- **Undo steps follow Logseq's**: back-to-back `EditText` and block `SetProperty` commands on one block form one undo step (a Loro undo group), and every other command is a step of its own, however fast they come. Merges from other devices close the open group.
- **Page names can repeat across devices.** Two devices creating the same name concurrently get two pages. Dedupe belongs in sync/integration.
- **Not measured here**: open time and memory at 50k blocks. The open path is the spike's measured one (import, page list, one page: about 390 ms), but there's no bench in this package yet.
- **Shared file touched**: `pnpm-lock.yaml` at the root (the new package's deps).
