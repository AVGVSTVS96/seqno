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

**Decision.** Each graph is a Loro document saved as an edit log, with `loro-crdt` pinned to exactly 1.16.2. Logseq markdown is what you import from and, later, a mirror that one device writes back. SQLite is only a cache.

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

**Decision.** SQLite holds everything reads need and is never synced. It stores the Loro version it reflects in the same transaction as its rows, rebuilds on a mismatch, and runs with relaxed durability (`journal_mode=memory`, `synchronous=off`).

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

**Decision.** Each device writes only `updates/<deviceId>/`, its own `seen/<deviceId>.json`, and the snapshots it makes, and it deletes only those. An update file is deleted once every member device has merged it and a snapshot confirmed by another device covers it. Device and peer ids are never reused. A device that never comes back blocks deletion until someone removes it by hand; a timeout may later prompt, never act silently.

**Why.** A device can't tell whether its upload reached the server. Another device downloading and checksumming the snapshot is the only proof. Without that step, 7 of 16 test runs briefly lost ops on the server.

**Numbers.** A simulator runs 5 devices for 12 to 48 simulated hours against a hostile fake iCloud: late and out-of-order notices, files listed before they are downloaded, eviction, 3% failed downloads, conflict copies, devices offline for 12 to 36 hours, and clocks off by up to 2 hours.

- 1,000 runs of 1k ops and 100 runs of 10k ops all converged with 0 lost ops, 0 files with two writers, and 0 attempts to read a file that wasn't downloaded yet (placeholders came up 8.5M times). 200 more runs on fresh seeds found no violations.
- Removing any one of 5 safeguards makes the checks fail.
- After 10k ops, compaction leaves 49 files on average, against 2,346 without it. Files pile up to about 1,190 while a device is offline, then drop within hours of its return.
- Snapshots are the compaction format. On the 50k graph a snapshot is 12.6 MB and imports in 8 ms; the same history as one update file is 7.8 MB and takes 1.1 s (one probe). Compaction runs at 100 or more uncovered files, at most once an hour. Cloud storage peaks at 25.3 MB while compacting, then settles at 12.7 MB.
- Not covered yet: the full 1,000 runs of 10k ops, corrupt update files, a device restored from backup reusing its peer id, and iCloud losing a file.

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

## Smaller decisions

| Question                         | Answer                                                                   | Why                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Where `iCloud Drive/seqno` lives | The app's own iCloud container, shown as iCloud Drive › seqno            | Always reachable on iOS and simplest to watch. Needs the paid Apple Developer Program |
| File names                       | Sync files keep ASCII names; page names are NFC-normalized               | Apple's file APIs write NFD names, and JS compares strings byte by byte               |
| Memory target                    | Whole process, 150 MB, until a real iPhone run sets per-platform numbers | It is what the OS kills, and the only way to compare web with iOS                     |
| Ids passed to Loro               | Validate every id before calling Loro                                    | `tree.has(undefined)` crashes inside wasm and leaves the doc unusable                 |
