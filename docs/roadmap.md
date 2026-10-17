# Roadmap

Where seqno stands, what comes next, and what is still missing. How it works is in [architecture.md](architecture.md); why it is built this way is in [decisions.md](decisions.md).

```
web (done) ──▶ hardening (next) ──┬──▶ iOS + iCloud Drive
                                  └──▶ desktop (Electron)
```

## Web: done

The web app runs in Chrome and Edge on the real core: a Loro edit log, a SQLite index, and Logseq import.

- **Graphs.** Open a Logseq folder with the folder picker, or one of two demo graphs kept in the browser: a short tour, and a developer's notes that use most of what seqno renders. The first open imports the markdown; after that, edits save to the edit log as they land and survive a reload, and the header says when a save fails. A graph can be open in any number of tabs; they share one core worker, so each tab sees what the others type at once.
- **Pages.** Journals with today on top, every day back to the first, of which only the days near the screen are mounted, pages, aliases, tag pages, the All pages table, Mod+K full-text search, the right sidebar, favorites and recent pages. Renaming a page rewrites every reference to it.
- **Outlining.** Enter, Tab and Shift+Tab, drag, multi-block selection, collapse, zoom, moving blocks with keys, and undo and redo one command at a time. Pasting a markdown outline makes blocks.
- **Blocks.** Tasks and priorities, SCHEDULED and DEADLINE with a date picker, properties as `key:: value` lines, headings, code blocks edited in place, images with resizing, embeds, block references with counts, hover previews, and linked and unlinked references.
- **Queries.** Live `{{query}}` blocks drawn like Logseq's. They take Logseq syntax, or Dataview-style text.
- **Tests.** About 490 unit and component tests and 56 Playwright flows against a production build. A design harness puts 12 screens next to Logseq in light and dark.

Not done yet: sync between two real devices through iCloud Drive. The sync engine has passed the simulator and folder tests, but not a run on two computers.

## Hardening: next

Make the web app safe for real, large graphs before adding platforms:

1. Open lazily: load from the newest snapshot, show the visible page first, and keep the index on disk so it catches up instead of rebuilding. (Done: an open imports the newest snapshot without decoding it first, restores without events, and loads the saved index and catches it up in the background. Opening still decodes the one block tree to list the pages; the tree-per-page layout below removes that.)
   - **A tree per page.** Decided: one Loro doc with a tree per page (`graphV2Layer`, see [decisions.md](decisions.md)); a doc per page is dropped. Graphs kept in the browser use it: a new one starts on it with today's journal keyed by its day, and an existing one converts when it opens, checked page by page against its old files before they go. In Node it opens ten years of journals in 0.16 s instead of 1.0 s on one tree, 30 years in 0.42 instead of 2.8 s and 60 years in 0.87 instead of 5.6 s, with 0.37, 0.71 and 1.2 GB of memory instead of 0.47, 1.0 and 1.8 GB (a first open in a fresh process); the spike had estimated 0.35 against 5.5 s at 30 years. It converts a one-tree graph in 37 s at ten years, and runs bulk commands on a 20k-block page as fast as the one-tree layout. In Chrome on a CI runner, years kept in the browser show the first journal in 0.6 to 0.7 s at ten years, 1.1 to 1.5 s at 30 and 1.6 to 2.5 s at 60 (see Scale below); CI also runs its sync simulator suite. Still to do:
     - **Picked folders.** They stay on one tree, and this build refuses one a later build converted. Converting a synced folder waits on Bassim: every device that opens it has to run a build that reads the new layout first, and exactly one device converts it (the converter writes the same bytes on every device, but two conversions of two different sets of files would double the blocks). Converting ten years takes 37 s in Node and holds both layouts in memory while it checks them.
     - **Two calls on moves between pages**, which only matter once two devices edit one graph: moving a block as a pointer (built, keeps what other devices type into it) or as copy-then-delete, and whether that move should win over another device's delete, indent or move of the block. Browser graphs now write pointers, so a later change has to keep reading them.
2. Close the data-safety gaps below. Done so far: each open writes with a new peer id, two pages with one name merge into one, two devices importing the same folder write the same ops, merging a block with Backspace keeps its properties and its references, undoing a delete brings back the same blocks with what other devices typed into them, saving follows each edit and shows when it fails, the import lists the files it left out, and each tab undoes only its own edits.
3. Keep the edit log small on a single device, and show save state in the UI. (Done for graphs kept in the browser, and the header shows save state; a lone device on a synced folder still can't delete, see below.)
4. Turn on the markdown mirror so Logseq sees edits made in seqno.
5. Run the sync simulator on the real graph with every command and device restarts. (Done: 50 runs of 600 ops and 20 runs of 10k ops all converged.)
6. Check in a 50k-block benchmark that fails when open or typing goes over budget, and test sync on two real Macs. (The benchmark is in: `tools/bench` runs in CI, in Node for open and typing and in Chrome for ten years of journals and a 20k-block page, opened and scrolled. The `scale` workflow runs it by hand at any number of years; at 30 and 60 years both layouts still scroll the journals and the long page at a 16.7 to 16.8 ms frame p95 with no frame over 50 ms, and rows show 15 to 175 ms after a jump. The two-Mac test needs two Macs signed into iCloud.)

## iOS and iCloud Drive

An Expo app with loro-react-native (loro-ffi 1.16.2 at opt-level 3), a Swift vault module for coordinated atomic writes and file watching, and Loro moved off the JS thread. A prototype of the vault module passes 9 of 9 checks on the simulator, though 2 of them can only really fail once a second device exists.

- **Needs the paid Apple Developer Program** (99 USD a year). The free tier has no iCloud capability, so the app can't reach its iCloud container. Container ids can't be deleted, so the bundle and container ids get chosen once.
- **Then:** a real iPhone run (the simulator sits at 57.6 ms for a warm merge against a 50 ms target, and 149.4 MB against 150 MB), plus a second device for real conflicts, latency and download status.
- **Untested fallback** without the program: pick an iCloud Drive folder once in the document picker, and reinstall the app every 7 days.

## Desktop: Electron

Electron around the same web build, with graph folders anywhere on disk, including iCloud Drive on a Mac. The vault's node file adapter and the node:sqlite index driver already pass their tests. Nothing blocks it.

## Known gaps

### Data safety

- **Two devices can still import different versions of one folder.** Two devices that import the same files now write the same ops, so nothing doubles. If one of them is missing a file (not downloaded yet) or has an older copy of one, their imports differ: pages merge by name, and the blocks of pages both had end up twice.
- **Import leaves files out.** A file whose name matches an earlier page, or one that isn't downloaded or can't be read, is left out. The tab that ran the import now lists them in a notice until it is closed, but nothing retries them later, and the list isn't kept anywhere.
- **The editor matches its own edits by text.** It recognizes its edits coming back by comparing text, so a change elsewhere that happens to produce text it typed a moment ago could be taken for its own (found by reading the code, not reproduced). A rejected edit now shows a notice and puts the graph's text back in the editor, so a mismatch that leads to a rejection heals itself.
- **No device list.** The app counts only itself as a member, and there is no "remove this device" setting.

### Scale

- **Opening a picked folder grows with the graph.** On a CI runner a picked folder shows the first journal 1.2 to 1.8 s after opening ten years of journals (150k blocks, a 59 MB snapshot), 3.0 to 4.0 s after 30 years (410k blocks, 162 MB) and 6.9 to 7.4 s after 60 (800k blocks, 318 MB), against 0.6 to 0.7, 1.1 to 1.5 and 1.6 to 2.5 s for the same years kept in the browser on a tree per page. What's left on one tree is importing the snapshot and decoding the whole block tree the first time anything reads it, because every page and block lives in one tree, and reading every page root for the page list. Folders wait for their conversion (Hardening, step 1).
- **The first index fill grows with the blocks**: 25 to 35 s at ten years, 73 to 83 s at 30 and 113 s at 60 on a CI runner. Search and backlinks are partial until it ends, and later opens load the saved index and catch up instead. Most of it is SQLite calls made a block at a time (17 of 28 s at ten years, in Node with the browser's SQLite build) and reading every page, which the graph's background walk of every page also does (another 3 s). Rows show 47 to 93 ms after a jump during the fill, at every size.
- **Opening a 30k-block page takes about 2.8 s**: the core reads every block of the page, and the tab lays all of them out once. Scrolling it afterwards stays at 16.7 ms frames.
- **A reload during an index save waits for it.** The closing session finishes writing the whole index before the reloaded tab reopens the graph, so the first journal shows 0.8 to 1.0 s after the reload at ten years (a 72 MB index), 2.0 to 2.8 s at 30 (197 MB) and 3.8 s at 60 (386 MB); the index has the long page's last block 1.0 to 1.4, 2.8 to 3.0 and 5.2 s after it. Both go over their 2 s and 3 s budgets from 30 years.
- **Memory grows with the years.** Chrome holds 1.3 to 1.5 GB once ten years kept in the browser have filled their index, 2.5 GB at 30 years and 4.5 GB at 60. In the worker, Loro's and SQLite's wasm memory reaches 2.0 GB after the 60-year fill and 2.8 GB while it saves the index (in Node, same code). Wasm memory never shrinks, and a closed graph's Loro memory is given back only after a garbage collection, so a graph opened right after another big one starts on top of it: the open benchmark, which reopens 60 years and then opens a second copy, ends with Chrome at 8.9 GB. Loro's wasm can't pass 4 GB.
- **Big imports are very slow.** Import loads every page in one Loro commit. At 50k blocks that took about 3 minutes, and reopening the result about 2 more (at 10k blocks, under a second each). Committing one page at a time measured about 15 s in total.
- **Update files pile up on a lone device in a synced folder.** Each edit is saved as soon as the last write finishes, so typing can write a file per keystroke. Graphs kept in the browser compact at 100 files and delete what the snapshot covers. In a picked folder, deleting needs another device to confirm the snapshot reached the server, so a device that is alone there never deletes its update files or its hourly snapshots, and every open reads all of them.
- **Live queries re-run on any matching key.** The row-level check that cut re-runs from about 4 to 1 per keystroke exists in `@seqno/query` but isn't wired in.
- **A page re-reads in full** on every change to it. Fine for normal pages, likely slow for one with tens of thousands of blocks (not measured).

### UI

- **Missing features:** flashcards, plugins, command palette commands and filters, All pages views and filters, linked-reference filters, a toolbar for selected blocks, OPML, HTML and EDN export, the query builder menu, and Settings beyond General and Keymap.
- `[[` suggests pages only; Logseq 2.x also lists matching blocks.
- Favorites live in app storage, not `config.edn`, so Logseq doesn't see them and a Logseq graph's favorites aren't imported.
- The date picker stays in edit mode after Submit and has no keyboard navigation. Resizing an image writes its width only.
- No exit animation for the palette and editor popups.
- Safari and Firefox get no notice. The plan is a screen that points to Chrome or Edge.

### Tests and tooling

- The sync simulator's mutants switch bugs on only in the stand-in vault, and its restarts are clean: a crash that loses unsaved edits isn't simulated.
- Browser flows fail on page errors but not on errors inside the core worker.
- Lint doesn't stop UI code from importing core-only libraries such as `loro-crdt` directly, and nothing enforces the exact Loro version for new packages.
- `fixtures/` sits outside lint and formatting. It is in the repo map as a tool, so only other tools (like `tools/bench`) can use the 50k-block generator.
