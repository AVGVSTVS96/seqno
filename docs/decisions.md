# Decisions

Why seqno is built the way it is, and the measurements that settled each choice. How the pieces fit together is in [architecture.md](architecture.md).

Unless noted, numbers come from a generated graph of 50k blocks on 1,865 pages (depth up to 10, with refs, tags, tasks and properties; a 17 MB snapshot holding 5.67M ops of history). Web numbers are from headless Chrome 153 on a Ryzen 7 5700G, iOS numbers from the iOS 27 simulator on an M1 Max. Most benchmarks ran three times; medians are shown. The benchmark code is kept at the [`phase-0` tag](https://github.com/AVGVSTVS96/seqno/tree/phase-0/spikes).

## Key measurements

| What                                            | Web (Chrome, wasm)                     | iOS simulator (native) | Target                   |
| ----------------------------------------------- | -------------------------------------- | ---------------------- | ------------------------ |
| Open: build the full block map                  | 1,181 ms (1,313 ms with 200 updates)   | 2,435 ms               | 1 s                      |
| Open: page list and first page                  | 388 ms, plus about 0.3 s reading files | 178 ms                 | 1 s                      |
| Keystroke p95 (edit, event, block map)          | 0.14 ms                                | 0.053 ms               | 16 ms                    |
| Merge 1k remote edits: first after open / warm  | 110 / 48.9 ms (V8 in Node)             | 97 / 57.6 ms           | 50 ms                    |
| Whole-process memory, lazy open                 | 146 MB                                 | 149.4 MB               | 150 MB                   |
| Whole-process memory, full open                 | 242 MB (381 MB with SQLite)            | 303 MB (451 MB peak)   | 150 MB                   |
| Slowest of 15 real queries, p95                 | 12.9 ms                                | -                      | 50 ms                    |
| Index write and live refresh per keystroke, p95 | 5.6 ms relaxed, 14.1 ms durable        | -                      | 16 ms, off the UI thread |

## Loro is the source of truth, markdown is a mirror

**Decision.** Each graph is a Loro document saved as an edit log, with `loro-crdt` pinned to exactly 1.16.4. Logseq markdown is what you import from and, later, a mirror that one device writes back. SQLite is only a cache.

**Why.** If markdown files were the truth, two devices editing one page would write the same file, and a synced folder can only keep one version or make a conflict copy. A CRDT merges both edits. Loro has the two structures an outliner needs built in: a tree whose nodes can move, and rich text per node. The same engine runs on the web (wasm) and on iOS (Rust), and both read each other's bytes, which is why the version is pinned on both sides.

**Numbers.** Web and iOS applied the same 10k edits (two runs, different seeds) and ended deep-equal: 52,005 tree nodes, identical version vectors, and snapshots that import both ways. A keystroke costs 0.14 ms on the web and 0.053 ms on iOS, about 100 times under a 16 ms frame.

## Open lazily

**Decision.** Opening a graph loads the page list and the visible page first. The rest fills in behind it. No platform builds the full block map at open.

**Why.** Importing the bytes is cheap; reading 52k nodes back out is not. Importing the snapshot takes 16 ms, and almost all of a full open is reading every node.

**Status.** `@seqno/graph` opens this way, but the web worker doesn't use it yet (see [roadmap.md](roadmap.md)).

**Numbers.** Full open: 1.2 to 1.3 s on the web and 2.4 s on iOS, 2.39 s of it moving the tree into JS across the native bridge. Lazy open: 388 ms on the web (about 0.7 s counting file reads and wasm start) and 178 ms on iOS. Lazy open also keeps whole-process memory near 150 MB, against 242 to 451 MB for a full open. Import order matters too: the snapshot, then each update file one at a time, uses 82 MB of wasm memory and is fastest; importing everything in one batch uses 334 MB.

## Merges never run on the UI thread

**Decision.** A merge must never block typing. A warm 1k-edit merge in 50 ms is a target, not a gate. The web merges in the core worker. On iOS, Loro has to move off the React Native JS thread.

**Why.** A lazy open moves cost into the first merge, and catching up after a long time offline takes seconds whatever the target is.

**Numbers.** Merging 1k remote edits takes 110 ms the first time after open and 48.9 ms warm on the web, 97 and 57.6 ms on iOS. The iOS engine alone takes 23.5 ms; about 34 ms of the 57.6 goes to handing events to JS. Catching up after 12 to 36 hours offline costs 1.5 to 1.8 s of CPU on the 50k graph. Two ideas to try later: warm the doc after open, and send events only for open pages.

## SQLite is a relaxed, rebuildable index

**Decision.** SQLite holds everything reads need and is never synced. It is saved whole with the Loro version it reflects, catches up from that version on the next open, is filled from the graph when it can't, and runs with relaxed durability (`journal_mode=memory`, `synchronous=off`). How it is saved is below, in "The index is saved whole to OPFS and caught up from its stamp".

**Why.** The edit log can always rebuild it, so durability would only add latency.

**Numbers.** One keystroke's index write plus live-query refresh: 5.6 ms p95 relaxed against 14.1 ms durable (the write alone: 2.9 against 10.3 ms). The slowest of 15 real queries runs in 12.9 ms p95, the median query in 1.7 ms. Building the 50k index from scratch takes 2.1 to 2.2 s in Chrome. Writes sometimes spike to 70-77 ms relaxed or 175 ms durable, which is another reason they live in the worker. Five queries checked against a plain-JS reimplementation on a 20k-block graph matched exactly, with nothing missing or extra.

## Loro on iOS: loro-ffi at opt-level 3

**Decision.** iOS uses loro-react-native built from source, with loro-ffi pinned to 1.16.2 and Rust built at `opt-level=3` instead of upstream's size-optimized `"z"`.

**Why.** It is the same engine and file format as the web, and opt-level 3 is 2 to 6 times faster for about 2 MB more app size.

| Same app, back to back       | opt-level `z` | opt-level `3`  |
| ---------------------------- | ------------- | -------------- |
| Snapshot import              | 218 ms        | 36.5 ms        |
| Lazy open                    | 408 ms        | 178 ms         |
| Full open                    | 4,359 ms      | 2,382-2,394 ms |
| Merge 1k, warm / engine only | 115 / 62 ms   | 57.6 / 23.5 ms |
| App size                     | about 36 MB   | 38 MB          |

**Rejected.** loro.js 0.3.0 on Hermes: a 9.0 s import, a 10.2 s lazy open, an 18.1 s first merge, 514 MB, and merge events that didn't match the document. A WebView running the wasm build wasn't built: the native engine already merges as fast as wasm (23 to 27 ms against 22 to 33 ms), and a WebView would add another bridge to cross.

## Sync: one writer per file, delete only after a confirmed snapshot

**Decision.** Each device writes only `updates/<deviceId>/`, its own `seen/<deviceId>.json`, and the snapshots it makes, and it deletes only those. An update file is deleted once every member device has merged it and a snapshot confirmed by another device covers it. Device and peer ids are never reused: every open of a graph writes with a new peer id (see below). A device that never comes back blocks deletion until someone removes it by hand; a timeout may later prompt, never act silently.

**Why.** A device can't tell whether its upload reached the server. Another device downloading and checksumming the snapshot is the only proof. Without that step, 7 of 16 test runs briefly lost ops on the server.

**Numbers.** A simulator runs 5 devices for 12 to 48 simulated hours against a hostile fake iCloud: late and out-of-order notices, files listed before they are downloaded, eviction, 3% failed downloads, conflict copies, devices offline for 12 to 36 hours, and clocks off by up to 2 hours.

- 1,000 runs of 1k ops and 100 runs of 10k ops all converged with 0 lost ops, 0 files with two writers, and 0 attempts to read a file that wasn't downloaded yet (placeholders came up 8.5M times). 200 more runs on fresh seeds found no violations.
- Removing any one of 5 safeguards makes the checks fail.
- After 10k ops, compaction leaves 49 files on average, against 2,346 without it. Files pile up to about 1,190 while a device is offline, then drop within hours of its return.
- Snapshots are the compaction format. On the 50k graph a snapshot is 12.6 MB and imports in 8 ms; the same history as one update file is 7.8 MB and takes 1.1 s (one probe). Compaction runs at 100 or more uncovered files, at most once an hour. Cloud storage peaks at 25.3 MB while compacting, then settles at 12.7 MB.
- A graph kept in the browser never syncs, so there is no server for a snapshot to reach: its vault is `synced: false`, a snapshot it wrote counts as confirmed, and it compacts at 100 files with no hourly wait. `tools/e2e/flows/editlog.e2e.ts` types 120 keys into a demo graph (one file each) and sees the folder drop to under 10 update files and one snapshot.
- The simulator also drives the real graph and vault (`--graph real`): every command, including split, Backspace merge, indent, outdent, undo, redo and pages created under one name on several devices, and devices that close their graph and reopen it with a new peer id every few simulated hours. 50 runs of 600 ops (1,200 restarts) and 20 runs of 10k ops (seeds 1 to 20) all converged, with every device and a fresh device reading only the cloud ending on the same pages and outlines, no two live pages with one name, and no block id twice.
- A 10k-op run on the real graph takes about 5 CPU minutes and up to 0.9 GB.
- Not covered yet: corrupt update files and iCloud losing a file. A device restored from backup can no longer reuse a peer id, since no open does.

## Queries: Logseq-style first, Dataview-style second

**Decision.** The main syntax is Logseq's `{{query ...}}`, extended with typed fields, `sort-by`, `group-by`, `view`, `limit` and `under`. Dataview-style `LIST | TABLE | BOARD` is a second input. Both parse to one typed AST that compiles to SQL. Logseq's advanced queries are translated where possible.

**Why.** Queries should feel the same as in Logseq, and Logseq's own queries keep working when pasted in. It is also the shortest syntax. Dataview reads like English and suits tables, so it stays as an option. A third, Datalog-style syntax was dropped: it looks like Logseq's advanced queries but has no variables or joins, so it would invite the wrong expectations.

**Numbers.** The same 15 real queries take 763 characters in Logseq style, 975 in Dataview style and 1,119 in the Datalog style; the Logseq-style parser is about 130 lines. 15 of 18 collected queries can be written; the other 3 need properties of a referenced page, aggregates, or view code. 12 of 14 advanced queries translate automatically. With 20 live queries open, a keystroke re-ran 1.05 of them on average with the row-level check and 4.1 with key matching alone (the app wires only key matching so far), and no result was ever stale. "TODOs not under a DOING task" took 20 lines of Datalog rules in Logseq; here it is `{{query (and (task todo) (not (under (task doing))))}}`.

## Desktop: Electron

**Decision.** The desktop app is Electron around the same web build.

**Why.** Electron ships Chromium, the same engine the web app targets, so File System Access, OPFS and sqlite-wasm behave the same and the web's tests cover desktop too. It is the most proven option. The alternatives each break that match or aren't ready: Electrobun is young and uses the system WebView (Safari's engine on a Mac) unless it bundles Chromium, which erases its size advantage; Tauri also uses system WebViews, so web features vary by platform; react-native-macos trails React Native by several versions and can't share the Expo codebase. The core sits behind `@seqno/rpc`, so swapping the shell later touches only the thin desktop wrapper.

**Numbers.** None. This one was decided on engine fit, not a benchmark.

## Web sync needs Chrome or Edge

**Decision.** The web app targets Chromium browsers. A graph that syncs lives in a real folder (for example in iCloud Drive) that you pick with the File System Access API. A local-only mode for Safari was dropped.

**Why.** File System Access is the only browser API that reads and writes a folder on disk. Safari and Firefox have no writable directory picker, so they could only keep a private OPFS copy that never syncs. Dropping that mode also removes one storage adapter to build and test.

**Numbers.** Measured from native code on macOS against real iCloud Drive:

- A coordinated 4 KB write takes 13.9 ms p50 and 37.6 ms p95, more than a 16 ms frame, so writes are batched and kept off the keystroke path.
- Reading a file iCloud has evicted blocks for about 0.85 s while it downloads, so seqno checks a file's download status before reading it wherever the platform reports one.
- An atomic 32 MB overwrite never showed a partial file; a non-atomic one showed 31 partial sizes. Every vault write is atomic.
- Not measured yet: Chrome reading an evicted iCloud file.

## A new peer id every time a graph opens

**Decision.** Each open of a graph mints a random 64-bit Loro peer id for that session. Update files are named `updates/<deviceId>/<peer>-<n>.loro`. Snapshots are named by the device id, so a device still knows its own snapshots after its peer id changes; snapshots from before this change, named by the profile's old fixed peer id, count as its own too.

**Why.** Loro identifies every op by peer id and counter. A device that kept one peer id and opened a graph with some of its own update files missing (not downloaded from iCloud yet, evicted, or restored from a backup) started counting again from where its copy ended, so its new ops took ids its earlier ops already had. Loro treats a second op with a known id as a copy and drops it, so the devices disagreed for good, without an error. Loro's docs give the same rule: reuse a peer id only when the doc is known to hold every op that peer wrote. A fresh peer per open meets it without having to prove anything about the folder. It also makes the old file name `<n>.loro` unsafe, since two peers both start at counter 0.

**Cost.** Each open that edits adds one entry to the version vector, which the index and `seen` files store. That is a few bytes per editing session. Opening a graph without editing adds nothing.

**Numbers.** None on speed. `apps/web/src/worker/test/core.test.ts` moves one of the device's own update files away, edits again, puts it back and reopens: both edits survive. With the old fixed peer id the same test loses the first edit.

## Two pages with one name merge into the older one

**Decision.** When a commit or a merge leaves two live pages with one name, the graph merges them right away, before any event goes out: the page with the smaller id (UUIDv7, so the older one) keeps its blocks, the other's top-level blocks move to its end in order, and the other's page properties fill keys the survivor doesn't have. The merged-away page isn't deleted. It stays as an empty root marked `mergedInto: <survivor id>`, which every read skips, and any block that later lands under it moves to the survivor too. The repair commits with its own origin, so undo never takes it back.

**Why.** Each device creates today's journal on open, so two devices opening one graph on the same day before syncing made two pages with one name, and the index's unique name rule then stopped the graph from opening at all. Any device has to be able to fix it on its own, and two devices fixing it at once must agree: picking the survivor by id gives every device the same answer, and moving the same blocks to the same page twice converges in Loro's tree. Deleting the merged-away page would lose data: a device that hadn't heard of the merge yet (offline all day, say) keeps adding blocks to it, and Loro deletes whatever is created under a deleted node. Keeping it as a hidden root lets those blocks arrive and move over. The index no longer requires unique names either, so a bug here shows two pages instead of a graph that won't open.

**Numbers.** None on speed: the name check runs only when a commit touched a page itself (created, renamed, merged in), not on typing. Tests: `packages/graph/test/sync.test.ts` (two devices, and a block added to the merged-away page before its device heard of the merge) and `apps/web/src/worker/test/core.test.ts` (a folder where a second device made today's journal opens with one journal holding both; before the fix it failed with `UNIQUE constraint failed: pages.name_lc`).

## The import is a pure function of the folder

**Decision.** Importing a Logseq folder gives the same Loro ops on every device that reads the same files. Ids that aren't kept from an `id::` come from a seeded generator (xoshiro128\*\*, seeded with SHA-256 of `config.edn` and every imported path and file). The pages are then written on an empty doc under a peer id taken from SHA-256 of the pages themselves, with block times set to noon UTC of the latest journal day (0 when there are no journals) instead of the clock. The device saves those ops as their own update file, `updates/<deviceId>/<importPeer>-0.loro`, and switches back to its session peer.

**Why.** Two devices that opened one Logseq folder before either's edit log had synced each imported it with fresh random ids, so every page and block existed twice. A rule like "only one device imports" needs a lock, and a synced folder has none. Making both imports identical needs nothing: Loro names every op by peer and counter, and drops a second copy of a known op on merge. The peer is hashed from the output, not the input, so two different imports never share op ids: if the files, the parser or the loader differ in any way, the pages differ and so does the peer. The times can't come from the clock, since two devices never import at the same millisecond; the latest journal day is roughly when the graph was last written to.

**Cost.** An import's update file isn't one session's ops, so the vault's rule changed from "this session's peer only" to "one peer per file, named after it". Import now reads every file before parsing, so the folder's text is in memory at once, as the parsed pages already were.

**Numbers.** None on speed. `apps/web/src/worker/test/core.test.ts` imports one folder as two devices, then shows the second device's files to the first: pages and blocks match a single import exactly. With random ids the same test finds every block twice.

## Deleting moves to a hidden trash

**Decision.** `DeleteBlocks`, `DeletePage` and the emptied block of a `MergeWithPrevious` move their nodes under a root marked `trash` instead of calling Loro's delete. Undoing an insert or a new page moves it there too, and redo moves it back. Everything under it reads as deleted: events report `BlockDeleted` and `PageDeleted` when nodes go in, and `BlockUpserted` and `PageUpserted` when undo moves them out.

**Why.** Loro refuses to move a deleted node, so a deleted original can't come back; Loro's own undo of a tree delete created a new node with the old data. Text another device typed into the deleted block before it heard of the delete stays on the old node and is lost on undo. A move is undone by moving back, so the original node, with every concurrent edit, returns.

**Cost.** Deleted blocks stay in the doc, as Loro already keeps deleted nodes' state to merge concurrent edits. Nothing empties the trash yet.

**Numbers.** None. `packages/graph/test/sync.test.ts` deletes a block on one device while another types into it, undoes the delete, and both devices end with the typed text; with Loro's delete the undo brings back the block without it.

## Undo is seqno's own, not Loro's UndoManager

**Decision.** `@seqno/graph` keeps its own undo. Each command records its inverse as it applies, through a recorder that every mutation goes through: a text edit records a delta that takes it back, a new block or page records "move it to the trash", a move (a delete is a move into the trash) records the old parent and the sibling the node came after, and a property or field write records the old value. Each tab has its own undo and redo stacks of up to 100 steps. Undo applies the top step's inverses in reverse through the same recorder, which records the redo. Nothing reads Loro's history: undo works on the current state only.

**Why.** Loro 1.16.4's `UndoManager` works out each step by checking out the version before it and back. Checking out an older version rebuilds every text changed since by replaying the whole history from empty ([loro.rs](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-internal/src/loro.rs#L1291-L1319), [diff_calc.rs](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-internal/src/diff_calc.rs#L1804-L1823), [replay](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-internal/src/diff_calc.rs#L559-L599)), so one undo costs (blocks changed since the step) × (size of the history), and every block another device edits makes the next undo slower. Loro text cursors can't anchor the inverses either: finding where a deleted character was goes through the same replay ([`query_pos_internal`](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-internal/src/loro.rs#L2711-L2790)).

How text stays right without cursors: a text inverse is a delta in the block's current positions, and every Loro event on that block (another tab, another device, this tab's own later steps) rebases it, the way operational transforms rebase a pending change. Text someone else typed inside a range the step would delete splits that delete around it, so undo never removes their characters. Typing in one block keeps composing into one step, even across merges. Rebasing through a step and then through its undo is not a round trip where deleted text collapses to one position (delete a word, later delete the letter after it, undo both: the word would come back after the letter). So each pending text inverse also remembers what it was before each of this tab's later steps, and undoing a step puts that back exactly; redoing it puts back the other side.

What carried over and what changed. Per-tab history, one step per command or per typing run in one block, deletes that bring back the same nodes, and edits from other devices never undone, all as before. New: a step leaves alone any property or block that another tab or device changed after it (Loro's undo put its own value back over theirs); undoing an insert moves the block to the trash instead of deleting it, so redo brings back the same block; and a rejected `DispatchAll` is rolled back instead of left half applied for the next commit to carry.

**Limits.** One tab's own history undoes and redoes exactly. When another tab or device edited the same block between a step and its undo, positions come from rebasing alone, as with Loro's own undo: text put back next to someone else's insert at the same spot can land on the other side of it, and a character typed, then deleted in a later step, can survive both undos.

**Cost.** Each change to a block rebases only the inverses pending on that block. Steps hold Loro handles to their nodes and texts plus the doc and tree they came from, and the rebasing is keyed by doc and text, so a later split into one Loro doc per page adds more of them without changing the history.

**Numbers.** Node on `cloud` (a Fly.io Sprite): type into 5 blocks (10 steps), merge edits another device made to 0 to 1,000 blocks (including those 5), then undo all 10 steps. Ranges are over the 10 undos.

| Undo one step                   | Loro's `UndoManager` | seqno's own   |
| ------------------------------- | -------------------- | ------------- |
| 50k graph, no other device      | 73 to 727 ms         | 0.4 to 2.8 ms |
| after 10 edits from another one | 0.59 to 0.66 s       | 0.3 to 1.9 ms |
| after 100                       | 6.1 to 6.4 s         | 0.3 to 2.3 ms |
| after 1,000                     | 61.8 to 63.0 s       | 0.3 to 2.6 ms |
| 10 years of journals, no other  | 0.23 to 3.1 s        | 0.4 to 3.3 ms |
| after 10                        | 2.2 to 2.5 s         | 0.3 to 6.7 ms |
| after 100                       | 21.5 to 22.5 s       | 0.4 to 3.1 ms |
| after 1,000                     | 187 s (one probe)    | 0.3 to 2.8 ms |

On the 10-year graph a cursor resolves in 0.06 ms while its character exists and in 188 ms to 2.4 s once it was deleted. `tools/bench` checks "undo after 1k edits from another device" against 16 ms on every CI run (2.4 ms on `cloud`). The sync simulator's real-graph runs, whose workload undoes and redoes, passed 50 of 50 seeds of 600 ops and 6 of 6 seeds of 10k ops (seeds 1 to 6, at most 937 MB) with no violations. `packages/graph/test/undo.test.ts` runs 30 random sessions on one device that must undo to the exact starting text and redo to the exact edited text, and 30 with a second device typing into the same block that must keep every character it typed.

## Save each edit as it lands

**Decision.** The core saves when an edit lands instead of every 250 ms: the edit opens a latch, a saver waits on it, closes it and writes everything new as one update file. Edits that arrive during a write open the latch again and go out in the next write. The saver publishes its state (`Saved`, `Unsaved`, `Failed` with the storage error's reason) to every tab.

**Why.** The timer meant an edit waited up to 250 ms before anything tried to write it. When the last tab closes, Chrome ends the SharedWorker, and that wait was often longer than the worker had left. Saving on the edit itself leaves only the write. Failures used to be logged inside the worker, where nobody sees them.

**Cost.** More, smaller update files while typing, often one per keystroke, which makes compacting on one device (Hardening, step 3) more pressing.

**Numbers.** `tools/e2e/flows/tabs.e2e.ts` types and closes the only tab at once, then opens a new one: 20 of 20 runs kept the edit. With the 250 ms timer, at least 8 of 10 lost it.

## Every tab shares one core worker

**Decision.** The core worker is a SharedWorker. Every tab of one seqno build talks to it, so a graph open in several tabs is one Loro doc, one index and one peer id, and edits from any tab go through one writer. A Web Lock per graph keeps a second worker (a tab still on an older build) from writing it at the same time. A newer build takes a graph over by stealing its handover lock: the older worker saves, releases the graph and tells its tabs to reload. Each tab holds a lock of its own, and the worker waits on it to learn when the tab closes.

**Why.** A Loro peer id must never have two writers, and the vault writes one update stream per device. Before this, each tab ran its own worker with the profile's one peer id, so a graph could only be open in one tab and a second tab sat on a "this graph is open in another tab" screen. The alternatives cost more: a peer id per tab would mint new peers on every open and multiply the edit log's members, and N copies of the doc and index in memory; electing one tab's dedicated worker as leader means moving in-flight calls and every live watch to a new leader when that tab closes. A SharedWorker outlives any one tab, so closing or reloading a tab loses nothing while another tab has the graph. It works because the vault writes with File System Access writables and the index is in-memory SQLite: OPFS sync access handles, which only dedicated workers get, aren't used. Keeping the index on disk has to work within that, and does (see "The index is saved whole to OPFS and caught up from its stamp"). Each tab still gets its own undo history: the graph keeps undo and redo stacks per tab (see "Undo is seqno's own").

**Numbers.** None on speed: every tab already talked to a worker, and now it is the same one. The four flows in `tools/e2e/flows/tabs.e2e.ts` (two tabs typing, closing one, reloading one) passed 60 of 60 runs, 15 each, against a production build in headless Chrome.

## Open restores quietly and fills the index behind it

**Decision.** The first files merged into an empty graph go in through `restore`, which imports them with no Loro subscriber attached, so Loro computes no diff and no events come out. The graph merges any pages that ended up with one name, lists the pages, and the first page can be read at once. The index is then filled in the background from the graph's current state (`everything`, one batch per page), each batch in its own index write, with one refresh of every live query at the end. The fill steps aside after each batch, so reads from the tabs go first. Edits made meanwhile are indexed as usual between batches; an edit the index can't take yet, because it touches a page the fill hasn't written, is dropped and its pages are written again from the graph once the fill ends. Renames and Backspace merges, which read the index to find references, wait until the fill is done.

**Why.** Merging into a doc that has a subscriber makes Loro build a diff of the whole history, and the graph then turned it into events: most of the open went there, before the user saw anything. Loro keeps computing diffs once a subscriber has been attached, even after it is removed, so the graph attaches its subscriber only when the doc is first written. A batch reads its page's state at the moment it is written, and edits are indexed under the same write lock, so whichever comes second wins, and the index ends up matching the graph either way. The one edit that can't wait for its page's batch is a block moved from a page not yet written into one already written: its page is written again at the end. Effect's semaphores let a fiber that just released a lock take it again before a waiting one wakes, so a fill that never stepped aside held both locks until it ended, and the first journal waited for the whole fill.

**Cost.** For the first seconds after opening a large graph, search, backlinks and queries can show partial results; they refresh when the fill ends. This is now the first open only: later opens load the saved index and catch up (see the next section).

**Numbers.** In Chrome, ten years of journals (150k blocks, a 52 MB snapshot) went from 12.9 s to the first journal down to 4.1 s once the fill stepped aside and the page list was read once per version instead of three times; 30 years (390k blocks, 156 MB) from 14.9 s to 8.8 s. In Node on `cloud` (a Fly.io Sprite), opening the 50k graph from its snapshot to the first page took 13.5 s before (5.1 s of Loro diff, 3.2 s of events, 0.4 s of page repair, 3.9 s of index writes) and 0.93 s after, most of it Loro reading the tree for the page list. The background fill takes about 8 s there. Keystroke p95 stays under 1 ms for the graph plus the index write. `tools/bench` measures both on every CI run, against budgets of 1 s and 16 ms.

## The index is saved whole to OPFS and caught up from its stamp

**Decision.** The index stays in-memory SQLite. It is saved with `sqlite3_serialize` to one OPFS file per graph (`indexes/<graph>.sqlite`), written with `createWritable`, with a stamp in its `meta` table: the Loro version it reflects. An open loads the file in the background (`sqlite3_deserialize`), asks the graph which pages changed since the stamp (`findIdSpansBetween` from the stamp to now, then `getChangedContainersIn` for each span, mapped to the pages and blocks they touch), and rewrites only those pages, plus the pages the index had the touched blocks on. With no file, an image SQLite can't read, another schema version, or a stamp the edit log doesn't hold (another folder under the same name, a folder restored from backup), it fills from the graph as before. It saves after a fill or catch-up, when index writes go quiet and catching up on what changed since the last save would take the next open longer than a save takes now, and when a tab closes. Picked folders keep their index in OPFS too, never in the folder.

**Why.**

- A SharedWorker gets no `createSyncAccessHandle` and can't start a dedicated Worker (both checked in Chrome 154), so `opfs-sahpool` is out. `createWritable` works there and wrote 64 MB in 302 ms.
- `createWritable` writes to a swap file and replaces the file only on `close()` ([spec](https://fs.spec.whatwg.org/#api-filesystemwritablefilestream)), so a save cut off by the worker ending leaves the previous good copy. The next open catches up from that older stamp, which costs more pages but loses nothing.
- The stamp has to be a version the index fully reflects. Graph changes and their index writes now happen under one lock in the session (`record`), and a save reads the version and serializes under the same lock, so no change can sit between its commit and its index write when the stamp is taken. The old per-write stamp was read after the write and could name a change whose events hadn't been written yet. A save is skipped while a fill or catch-up runs.
- An image is checked in a scratch connection before it replaces the live one: once SQLite holds an image it can't read, even loading another one fails, because loading prepares a statement on the broken schema.
- On today's layout every page is a root of one Loro tree, and a move or delete changes only the tree container, so the catch-up reads the ops of changes that touched the tree (`exportJsonInIdSpan`) to find which nodes moved. Deleted pages sit in the hidden trash, so a node found there is looked up both as a page (gone) and as a block (whose old page the index knows).
- When to save follows events, not a timer. A save writes the whole index (67.5 MB at ten years), so saving after every keystroke is out. The saver wakes when the last pending index write ends, and saves only if (pages changed since the last save) × (the per-page time the last full fill measured, kept in the stamp) is more than the last save or load took. Typing on a few pages never pays for a save; a merge or rename that touches hundreds of pages does. Tabs release their Web Lock on `pagehide`, so the worker hears at once that a tab is closing; it saves then if other tabs keep the graph, and when the graph closes otherwise (after saving the edit log, which comes first).
- Picked folders: the index is per device and derived, and the folder syncs, so it never goes into the folder. OPFS is the same storage either way, keyed by the graph's name. Changes other devices made while the app was closed arrive as merged ops whose versions are after the stamp, so the catch-up covers them.

**Cost.** One more copy of the index on disk (67.5 MB at ten years), the image's bytes in the worker for a moment while saving or loading, and a stale file left in OPFS when a picked folder is forgotten. A reload right after the first fill can cut the first save off, so that reload fills again.

**Numbers.** Headless Chrome 154 on `cloud`, ten years of journals (150k blocks): the first open fills the index in 74 s and saves it 0.4 s later; reloading finds the last page in search after 4.2 s instead of 70.5 s. At 30 years (390k blocks) the first fill takes 4 minutes and the index is 185 MB; reloading finds the last page after 10.3 s instead of 229.5 s. In Node, loading the 50k-block graph's image and catching up after 300 keystrokes takes 9.5 ms, against 9.4 s for the fill. The 50 real-graph simulator seeds, 50 seeds of the real vault and 50 of the stand-in all converged after the change.

## Opening imports the newest snapshot without decoding it first

**Decision.** When the graph is still empty, the vault imports the newest snapshot straight away. It picks it by the versions the `seen` files already list, and takes the snapshot's version from the graph right after the import (before the graph merges same-named pages, which commits ops of its own). Older snapshots it covers are checked on the next pass, as every snapshot still is. A snapshot no `seen` file lists is tried after the listed ones, and who wrote it comes from its name's hash, as before.

**Why.** `decodeImportBlobMeta` builds a throwaway doc and loads every history block just to count changes ([fast_snapshot.rs](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-internal/src/encoding/fast_snapshot.rs#L551-L567), [change_store.rs](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-internal/src/oplog/change_store.rs#L878-L886)), and `import` checks the same checksum again anyway. Two rules keep the version honest. Once any update has been merged into the empty graph (it was waiting on a snapshot that wasn't downloaded yet), importing a snapshot also applies those updates, so the graph's version is larger than the snapshot's; the simulator caught a device that then deleted update files the snapshot didn't hold. From then on the vault decodes snapshots first, as before. And who owns a snapshot comes only from a device's own `seen` file, never from a conflict copy of it: a copy of a device's own file made it confirm its own snapshot.

**Numbers.** On `cloud`, the vault's first pass over ten years of journals went from 2.34 to 1.81 s in Node (median of three) and 30 years from 6.93 to 5.85 s. In Chrome it no longer spends 0.5 to 0.7 s decoding before the import at ten years. What's left is mostly the import and reading every page root for the page list, which the per-page layout addresses. In headless Chrome the first journal now shows 2.97 s after opening ten years instead of 3.50 s (the vault's pass: 2.06 instead of 2.50 s), and 7.3 instead of 8.2 s at 30 years (5.9 instead of 6.8 s); medians of ten opens and six. The import itself got a little slower, likely because the decode no longer grows Loro's memory before it.

## The journals list mounts only the days near the screen

**Decision.** The journals view lays out every day back to the first one, but mounts only the days within 1,200 px of the screen. The others are spacers: measured days keep their measured height, and days not yet seen take the average height of the measured ones. Spacers are watched with an `IntersectionObserver`, the same way the outliner windows its rows, using the outliner's `windowOf` and `segments`.

**Why.** The list used to mount three more days whenever its end came near and never unmounted any. Every day kept its rows, its page watch and its linked references, so scrolling back through a few months grew the DOM by about 350 nodes a day and frames got slower the further you went. Laying out every day also gives the scrollbar the whole range, so dragging it to 2019 lands in 2019.

**Numbers.** Ten years of journals in headless Chrome, scrolling 60 px a frame: frame p95 rose to 50 ms with 13 frames over 50 ms after about 100 days, and the DOM held 45k nodes. Windowed, p95 stays at 16.8 ms with none over 50 ms through 30 years, with 4 to 6 days mounted. `tools/bench` checks it in CI.

## Bulk commands touch each tree node a fixed number of times

**Decision.** A command on many blocks (delete, move, indent, outdent) keys its selection by node id once and works out each block's position once before sorting. Siblings come from one list per parent that the recorder fills on first use and keeps current as it moves nodes. Every recorder in a transaction shares those lists, since an `Undo` inside a `dispatchAll` moves nodes too.

**Why.** In loro-crdt 1.16.4's JS binding, every read of a tree node's `id` formats the id in Rust and decodes it into a new JS string ([`id`](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-wasm/src/lib.rs#L4818-L4822), [`TreeID` to `JsValue`](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-common/src/lib.rs#L1234-L1238)), about 1.3 µs each. `children()` builds a new JS object for every child on each call ([`children`](https://github.com/loro-dev/loro/blob/loro-crdt%401.16.4/crates/loro-wasm/src/lib.rs#L4986-L4997)), and wasm-bindgen registers each one with a `FinalizationRegistry` so its wasm memory is freed later. The selection dropped duplicates with a `findIndex` over the whole selection, so deleting 5,000 blocks read `id` 12.5M times: 16.4 s of the 17.6 s, by CPU profile. Moving went through the same selection. Indent asked Loro for the parent's children once per block, and outdent did the same for the parent and for the block taking the siblings. Indenting 300 of the page's 6,800 top-level blocks made about 2M of those objects, and 80% of its 10.4 s went to the garbage collector clearing them. Loro's own side was never the problem: its children are a B-tree, and finding a node's index is O(log n).

**Numbers.** Node on `cloud` (a Fly.io Sprite), the 20k-block page that the Chrome benchmark scrolls, each command dispatched on a freshly opened graph. Ranges are over runs.

| Command                             | Before               | After          |
| ----------------------------------- | -------------------- | -------------- |
| Delete 5,000 blocks                 | 17.4 to 17.6 s       | 0.31 to 0.48 s |
| Undo that delete                    | 0.31 s               | 0.33 s         |
| Move 5,000 blocks to the top        | 17.0 s               | 0.32 to 0.51 s |
| Indent 1,000 top-level blocks       | 114 s                | 0.17 s         |
| Indent 5,000 top-level blocks       | over 150 s (stopped) | 0.74 to 1.0 s  |
| Outdent 1,000 children of one block | 1.1 s                | 0.39 s         |
| Outdent 5,000 children of one block | over 380 s (stopped) | 1.1 s          |
| Index write for the 5,000 deletes   | -                    | 0.35 s         |

Pasting 5,000 blocks (1.2 to 1.7 s) never took this path. Its time is Loro writing and committing the new blocks plus the events for them, about 0.25 ms a block. `tools/bench` checks all four of its numbers (delete, its undo, move, indent) against 2 s on every CI run; a CI runner measured 0.55, 0.23, 0.27 and 0.67 s. The sync simulator's real-graph suite passed 50 of 50 seeds of 600 ops and 6 of 6 seeds of 10k ops with no violations.

**On the tree-per-page layout** (see "A tree per page, in one Loro doc"), the same four commands first took 2 to 3 times as long as on the one-tree layout, for the same kind of reason: calls into wasm per block. On that layout, whether a node shows, where its home is, where it is placed and which block it is come from four keys of its data map (`trash`, `ref`, `at`, `uuid`), and each helper read them again, one `LoroMap.get` each at 4 to 8 µs on the 20k-block page: deleting 5,000 blocks and undoing it made 173k of them, against 27k on the one-tree layout. Finding a block among its siblings was a binary search that asked Loro for a sibling's `index()` at every step, 312k calls to indent 5,000 blocks against 30k, and placing a block searched for it again after it had left the list, which ended in a linear scan each time. Now:

- `uuid`, `ref` and `trash` are written once, when a node is made, so they are read once and kept, keyed by the node's spot (`page|node`), which every spot carries from when it's made.
- `at` is read only for homes listed in `moved`, the only ones that can have it, through a JS set that mirrors the map.
- A page's sibling list takes the blocks the session has already read from what it knows (their home keys), and reads Loro only for the rest: the trash, pointers, and homes moved away. The search for a page's trash skips them the same way.
- A block is looked up among its siblings from its Loro index first, where it is unless hidden nodes come before it, and a selection is sorted by Loro index without building the list.

Every command now makes no more Loro calls than on the one-tree layout (deleting 5,000 blocks and undoing it: 7k `get`s instead of 173k, 7k `index()` calls instead of 47k). The benchmark also timed another graph's work: the graph it builds the long page with stayed open, and its background page read ran during the first timed command. It is closed first now.

| 5,000 of a 20k-block page, median of 10 | One tree | A tree per page, before | After  |
| --------------------------------------- | -------- | ----------------------- | ------ |
| Delete                                  | 341 ms   | 717 ms                  | 291 ms |
| Undo that delete                        | 203 ms   | 311 ms                  | 196 ms |
| Move to the top                         | 289 ms   | 791 ms                  | 362 ms |
| Indent                                  | 588 ms   | 1,148 ms                | 524 ms |

Node on the Ryzen 7 5700G, through the benchmark's own code, five processes of each, interleaved. Move's median includes a 40 to 60 ms full garbage collection of the benchmark's setup that lands in move's window on the tree-per-page layout and later on the other. With the heap collected before each command (six of each), the medians are 321 against 315 ms for delete, 229 against 246 for its undo, 294 against 322 for move and 678 against 715 for indent. `tools/bench` checks all four on both layouts against 2 s on every CI run. The sync simulator, running the tree-per-page graph against the real vault and index, passed 50 of 50 seeds of 600 ops with no violations after the change.

## A tree per page, in one Loro doc

**Decision.** A second layout, `graphV2Layer` in `@seqno/graph`, keeps each page's blocks in a Loro tree of its own (`blocks:<pageId>`), all in the one Loro doc per graph, and lists pages in flat maps keyed by page id (`titles`, `days`, `trashed`, `mergedInto`, and `pageData` for page properties). It is built next to today's one-tree layout and gives the same `Graph` service; the app still writes the one-tree layout, and switching waits on the open calls in [roadmap.md](roadmap.md).

**Why.** Loro decodes a tree container whole the first time anything reads it. With every page and block in one tree, opening ten years of journals spent most of its time decoding 150k nodes just to list the pages and show today's journal: the first touch of the one tree took 1.27 s, against 2.8 ms for one page's tree. A spike compared four layouts on the same ten and 30 years of journals (Node on `cloud`):

| Ten years, 150k blocks                          | A: one tree (today) | A + flat directory | B: a tree per page, one doc | C: a doc per page          |
| ----------------------------------------------- | ------------------- | ------------------ | --------------------------- | -------------------------- |
| Page list                                       | 1.34 s              | 0.24 s             | 0.23 s                      | 0.23 s                     |
| First journal after it                          | 2.5 ms              | 1.1 s              | 6.8 ms                      | 8 to 10 ms                 |
| Memory after open                               | 367 MB              | 370 MB             | 334 MB                      | 107 MB                     |
| Merge 1k remote edits to the 10 latest journals | 0.5 to 0.6 s        | 0.47 to 0.49 s     | 54 to 57 ms                 | 73 to 86 ms                |
| Merge 1k remote edits across the graph          | 0.6 s               | 0.6 s              | 0.84 to 0.88 s              | 1.5 to 9.2 s               |
| Compact: export the snapshot                    | 1.3 to 1.4 s        | 1.3 to 1.4 s       | 1.4 s                       | 3.5 to 3.8 s               |
| Files in the folder for the graph               | 1 snapshot          | 1 snapshot         | 1 snapshot                  | 6,655 (19,960 at 30 years) |

- A flat directory in front of the one tree lists pages fast but still decodes the whole tree for the first journal (4.2 s at 30 years), so the tree itself has to split.
- B and C both open fast. C also saves memory, but everything that spans pages gets harder: a merge loads every page doc it touches (711 of them for 1k edits), compaction writes thousands of files, the sync protocol would track a version per file, and Loro can't move a node between docs, so moving a block to another page would be copy-then-delete, which loses what another device typed into it meanwhile.
- B keeps one edit log, one version vector, one sync protocol and the vault as it is. C stays the fallback if a real iPhone shows memory matters.

How B works:

- **Moves between pages are pointer moves.** Loro moves a node only within its own tree. A block moved to another page keeps its home node, with its text and its whole subtree, where it is; the target page gets a pointer node, and the home's `at` key names it. A node shows only where `at` says, so two devices moving one block to two pages resolve by the last writer of `at`, the way Loro resolves its own concurrent moves, and text or children another device adds meanwhile land on the home node and show at the new place. Moving the block back home moves the home node and drops the pointer. Every home that ever got a pointer is listed in a `moved` map.
- **Repair looks only at what changed.** Same-name pages are looked for among the pages a change touched. Cycles (two devices moving two blocks under each other across pages) are looked for among the nodes a change touched, and only once some block has moved between pages; a cycle is cut at the block with the smallest id, which goes back to the top of its home page. A restore checks only the homes listed in `moved`.
- **Same-name pages merge through the directory.** `mergedInto[loser] = winner`, and the winner's page shows the loser's tree after its own. Nothing moves, so blocks a device that hadn't heard of the merge adds to the merged-away page still show.
- **Journals are keyed by day.** `journalPageId(day)` gives a day's journal the same page id on every device (`0000YYYY-MMDD-7000-8000-000000000000`), so two devices that each create today's journal before syncing write into one tree instead of making two pages that need a merge. The converter gives each day's journal that id.
- **Undo is keyed by doc.** The undo recorder records writes to any Loro map and keeps its rebasing state per doc, so the page trees and the directory maps share one history. A move between pages records the new pointer, the old placement going to the trash and the old `at`, so undo puts the block back with what other devices typed into it.

**Cost.** A move between pages wins over a delete, indent or move of the same block that another device made meanwhile, where Loro's own tree would pick the later one. A page that shows blocks moved in from a long page reads that page's tree the first time it opens. The snapshot is about 6% larger (63.0 against 59.4 MB at ten years).

**Numbers.** Ten years of journals with a 20k-block page, in Node: an open (restore the snapshot, list the pages, read today's journal) takes 0.20 to 0.38 s against 1.7 to 2.3 s on the one-tree layout, at 510 against 670 MB of whole-process memory. `tools/bench` opens it in a fresh process on every CI run against a 300 ms budget; a CI runner measured 109 ms. The spike put 30 years at about 0.35 s against 5.5 s; the built layout hasn't been measured there yet. `convertOneTree` converts a ten-year one-tree graph in 37 s, and converting the same files again gives byte-identical snapshots, so devices that convert one folder write the same ops. Bulk commands on a 20k-block page cost about what they cost on the one-tree layout (see "Bulk commands touch each tree node a fixed number of times"). Every `@seqno/graph` test runs on both layouts; `packages/graph/test/pages.test.ts` and `pages-fuzz.test.ts` cover moves between pages, pointers, merges and cycles, and `tools/sync-sim/test/pages.test.ts` checks moves between pages, same-day journals, page merges and undo across pages against the real vault and index.

## Smaller decisions

| Question                                     | Answer                                                                                                  | Why                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where `iCloud Drive/seqno` lives             | The app's own iCloud container, shown as iCloud Drive › seqno                                           | Always reachable on iOS and simplest to watch. Needs the paid Apple Developer Program                                                                                                                  |
| File names                                   | Sync files keep ASCII names; page names are NFC-normalized                                              | Apple's file APIs write NFD names, and JS compares strings byte by byte                                                                                                                                |
| Memory target                                | Whole process, 150 MB, until a real iPhone run sets per-platform numbers                                | It is what the OS kills, and the only way to compare web with iOS                                                                                                                                      |
| Ids passed to Loro                           | Validate every id before calling Loro                                                                   | `tree.has(undefined)` crashes inside wasm and leaves the doc unusable                                                                                                                                  |
| Update files that come before their snapshot | When a snapshot import brings the ops a held update was waiting on, the graph imports that update again | Loro 1.16.4 holds an update whose ops it can't place yet, but doesn't apply it when a snapshot supplies them, and the tree then goes wrong or panics on the next import. Importing it again applies it |
| Graph events between drains                  | One pending change per node, not every Loro event batch                                                 | Merging a few hundred update files held over a GB of event objects until the next drain; a 10k-op simulator run ran out of memory                                                                      |
| Graph view layout                            | `d3-force` for the layout, drawn on one canvas                                                          | Logseq's graph view is a force layout too, so it moves the same way; one canvas draws thousands of pages in a few batched paths per frame                                                              |
| Component props with defaults                | Defaults go in the body (`props.x ?? default`), never in the destructured parameter                     | `babel-plugin-react-compiler` 1.0.0 under Babel 8 skips any component with a destructured default and says nothing; `apps/web/test/compiler.test.ts` fails on any component the compiler skips         |
| Work a page's rows need                      | Worked out once per page version (`layOut`), not per render                                             | The compiler can't memoize values computed between hooks and passed on; a 30k-block page rebuilt its outline on every scroll step                                                                      |
