# seqno phase 1

All 15 phase 1 branches are merged into `main`. The web app now runs on the real core: a Loro graph saved as an edit log in OPFS, a SQLite index, and Logseq import. It is no longer the stub.

```
 UI thread (React, outliner, CodeMirror editor)
     │  @seqno/rpc over a Web Worker
     ▼
 core worker  apps/web/src/worker
     RealCore ── openSession ─┬─ Graph   (@seqno/graph, Loro 1.16.2)
                              ├─ Vault   (@seqno/vault, OPFS or a picked folder)
                              ├─ Index   (@seqno/index, sqlite-wasm)
                              ├─ import  (@seqno/interop + @seqno/syntax)
                              └─ queries (@seqno/query)
```

## What works end to end

Each of these is checked by a headless Playwright flow against a production build in Chrome:

- **Import a real Logseq graph.** The flow seeds `fixtures/graphs/og-syntax-mix` into the OPFS demo folder and opens it. The worker sees there is no edit log yet, imports the markdown, and writes `updates/<device>/0.loro`.
- **Journals render.** Today's journal sits on top, created on open if it is missing. Imported journals (`Mar 9th, 2025`) follow below it.
- **Pages render, and links navigate.** Clicking `[[project/Alpha]]` opens `/page/project%2Falpha`.
- **Editing works.** Click a block, type, Esc. Enter splits a block and Tab indents it. Undo, redo, merge, outdent and move all reach the real graph now; the stub used to reject them.
- **Edits survive a reload.** Local ops are flushed to the vault every 250 ms. After a reload, the graph is rebuilt from the update files.
- **Search finds blocks.** It uses FTS5 over the index. Page hits match names and aliases.

The demo graph still works with nothing seeded: an empty OPFS folder gets three starter files (today's journal, `Getting started` and `Ideas`), and those go through the same import path.

Screenshots at 1440x900 of the showcase graph are in `docs/screens/`, each as `<name>-light.png` and `<name>-dark.png`: `journals`, `page`, `showcase`, `editing`, `search`, `right-sidebar` and `all-pages`. How each one compares with Logseq is in `docs/design/UI.md`.

## How to run it

Wrap every command in `systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0` on this machine.

```sh
pnpm install
pnpm check                                        # lint, format, typecheck, vitest
pnpm --filter @seqno/web dev                      # open the URL it prints, click "Open the demo graph"
cd tools/e2e && pnpm exec playwright test         # builds and previews the app, runs the flows headless
SEQNO_SCREENS=1 pnpm exec playwright test flows/screens.e2e.ts   # refresh docs/screens
```

## Test counts

| Suite                    | Result                                                    |
| ------------------------ | --------------------------------------------------------- |
| vitest (`pnpm test`)     | 324 passed in 29 files, 0 failed                          |
| Playwright (`tools/e2e`) | 12 passed, 1 skipped (the screenshot flow, run on demand) |
| lint, format, typecheck  | clean in every workspace package                          |

New tests from this integration:

- `apps/web/src/worker/test/core.test.ts`: the real core over node storage and node:sqlite. It covers import on first open, an edit surviving close and reopen, search, and a live `{{query (task NOW DOING)}}`.
- `packages/graph/test/load.test.ts`: bulk load keeps the given ids and can't be undone.
- `packages/graph/test/sync.test.ts`: a reopened graph keeps saving after its own merged files.
- `tools/e2e/flows/import.e2e.ts`, plus the reload and Enter/Tab flows in `journal.e2e.ts`.

## What integration added to the contract

- `Graph.load(pages: PageTree[])` in `@seqno/graph` loads pages with the ids, journal days and props an import brings, with no undo step. Today's journal is created the same way, so `CreatePage` did not need a `journalDay`.
- `Search({ text })` in `@seqno/rpc` returns `{ pages, blocks }`. `WatchQuery` now takes real query text (Logseq syntax first, Dataview second) and re-runs only when keys from `readSet` change.
- `isReadKey` in `@seqno/index` turns `@seqno/query`'s read set into typed index keys.
- **Fix in `@seqno/graph`:** an empty graph that merges its own earlier update files now moves its flush mark past them. Before this, every reload tried to rewrite `0.loro`, and the vault refused.

## Known gaps, most important first

1. **Keys typed right after Enter go into the old block.** The editor only moves to the new block once the worker's split result comes back. A fast typist loses the first characters of a new block into the previous one. The Enter/Tab flow waits for the editor to move, so it does not hide this. Fix: split optimistically in the outliner, or queue keystrokes until the editor remounts.
2. **Open is not lazy in the worker yet.** Each open merges the whole edit log into an empty graph and fills an in-memory index from those events. That is fine for the fixtures. On the 50k graph it will cost the 1.2 to 2.5 s that phase 0 measured. Fixes:
   - Open the graph from the snapshot and update bytes through `Graph.layer`, and send only the visible page first.
   - Add `eventsSince(version)` to the graph, so the opfs-sahpool index (`layerWasm`, already built) can persist and catch up instead of rebuilding.
3. **Edits from the last 250 ms are lost on a reload.** There is no "saving" indicator and no flush on page hide.
4. **Two tabs on one graph share a peer id.** There is no Web Lock. The second tab's update file name collides, the vault rejects the write (`UpdateRejected`, logged), and that tab stops saving.
5. **Decisions carried over from the core integration:**
   - Block props live in `Block.props`, separate from the text. Syntax treats the text as the only source.
   - Logseq's v4 `id::` values are kept in `props.id`, because `BlockId` accepts only UUIDv7.
   - `[[Alpha Project]]` (an alias) and pages that exist only as references show "No page named … yet".
6. **The linked references panel is still a placeholder.** `index.backlinks` exists, but there is no RPC for it yet.
7. **Today's journal is created on open on every device.** Two devices can each create one for the same day, so after a sync the graph has duplicate journal pages.
8. **Folder graphs are not covered end to end.** "Open a folder" writes the edit log into the picked Logseq folder next to its markdown and imports the markdown on first open. But the seeded folder picker closes the page in headless Chrome, so no flow covers it. The markdown mirror is not wired.
9. **Search has no Mod+K shortcut.** It is only reachable as the sidebar page.
10. **`pnpm check` peaks at about 1.4 GB under the 1.5 GB cap.** The first run after an install or a config change can be OOM-killed while Vite re-optimizes deps for the outliner's browser tests. A rerun passes.
11. **The sync simulator still uses its stand-in graph.** It needs read-only inspection calls that the real graph doesn't have. The 1k and 10k suites were not run.
12. **Arrow keys between blocks land at the line end or start, not the same column.**
