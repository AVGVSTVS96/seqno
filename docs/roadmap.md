# Roadmap

Where seqno stands, what comes next, and what is still missing. How it works is in [architecture.md](architecture.md); why it is built this way is in [decisions.md](decisions.md).

```
web (done) ──▶ hardening (next) ──┬──▶ iOS + iCloud Drive
                                  └──▶ desktop (Electron)
```

## Web: done

The web app runs in Chrome and Edge on the real core: a Loro edit log, a SQLite index, and Logseq import.

- **Graphs.** Open a Logseq folder with the folder picker, or one of two demo graphs kept in the browser: a short tour, and a developer's notes that use most of what seqno renders. The first open imports the markdown; after that, edits save to the edit log as they land and survive a reload, and the header says when a save fails. A graph can be open in any number of tabs; they share one core worker, so each tab sees what the others type at once.
- **Pages.** Journals with today on top (more days load as you scroll), pages, aliases, tag pages, the All pages table, Mod+K full-text search, the right sidebar, favorites and recent pages. Renaming a page rewrites every reference to it.
- **Outlining.** Enter, Tab and Shift+Tab, drag, multi-block selection, collapse, zoom, moving blocks with keys, and undo and redo one command at a time. Pasting a markdown outline makes blocks.
- **Blocks.** Tasks and priorities, SCHEDULED and DEADLINE with a date picker, properties as `key:: value` lines, headings, code blocks edited in place, images with resizing, embeds, block references with counts, hover previews, and linked and unlinked references.
- **Queries.** Live `{{query}}` blocks drawn like Logseq's. They take Logseq syntax, or Dataview-style text.
- **Tests.** About 490 unit and component tests and 56 Playwright flows against a production build. A design harness puts 12 screens next to Logseq in light and dark.

Not done yet: sync between two real devices through iCloud Drive. The sync engine has passed the simulator and folder tests, but not a run on two computers.

## Hardening: next

Make the web app safe for real, large graphs before adding platforms:

1. Open lazily: load from the newest snapshot, show the visible page first, and keep the index on disk so it catches up instead of rebuilding.
2. Close the data-safety gaps below. Done so far: each open writes with a new peer id, two pages with one name merge into one, two devices importing the same folder write the same ops, merging a block with Backspace keeps its properties and its references, undoing a delete brings back the same blocks with what other devices typed into them, and saving follows each edit and shows when it fails.
3. Keep the edit log small on a single device, and show save state in the UI.
4. Turn on the markdown mirror so Logseq sees edits made in seqno.
5. Run the sync simulator on the real graph with every command and device restarts, then the full 1,000 runs of 10k ops.
6. Check in a 50k-block benchmark that fails when open or typing goes over budget, and test sync on two real Macs.

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
- **Import skips files without saying so.** A file whose name matches an existing page, or one that isn't downloaded or can't be read, is left out. The import runs once and its issue list isn't shown.
- **Rejected edits are dropped quietly.** The UI ignores a rejected command, and the editor recognizes its own edits coming back by comparing text, which could skip a real change after an undo (found by reading the code, not reproduced).
- **Undo is shared between tabs.** Tabs on one graph share one undo history, so Mod+Z in one tab can undo what was typed in another.
- **No device list.** The app counts only itself as a member, and there is no "remove this device" setting.

### Scale

- **Open isn't lazy yet.** Every open merges the whole edit log into an empty document and fills an in-memory index from every event. At 50k blocks the index fill alone takes several seconds.
- **Big imports are very slow.** Import loads every page in one Loro commit. At 50k blocks that took about 3 minutes, and reopening the result about 2 more (at 10k blocks, under a second each). Committing one page at a time measured about 15 s in total.
- **Update files pile up on one device.** Each edit is saved as soon as the last write finishes, so typing can write a file per keystroke. Deleting needs another device to confirm a snapshot, so a lone device never deletes its update files or its hourly snapshots, and every open reads all of them.
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

- The sync simulator drives a stand-in graph. It never restarts a device and never runs split, merge, indent, outdent, undo or redo.
- Browser flows fail on page errors but not on errors inside the core worker.
- Lint doesn't stop UI code from importing core-only libraries such as `loro-crdt` directly, and nothing enforces the exact Loro version for new packages.
- `fixtures/` sits outside lint, formatting and the repo map, so package tests can't use the 50k-block generator.
