# web (apps/web) results, phase 1

## What works

Checked end to end in headless Chrome against a production build: open the demo graph, see today's journal, follow a favorite, edit a block, collapse a parent, search, reload and see the graph under "Recent graphs".

```
 UI (main thread)                                  core worker (src/worker/)
 ─────────────────────────────────────────         ──────────────────────────────────
 main.tsx   RegistryProvider + RouterProvider       main.ts   RpcServer(CoreRpcs)
 router.tsx /  /page/$name  /all-pages  /search               + BrowserWorkerRunner
 atoms.ts   appRuntime ── CoreClient (RpcClient) ►  stub-core.ts   in-memory handlers
            GraphLocations (IndexedDB, FSA, OPFS)   graph-state.ts pure command logic
 ui/        Shell, sidebars, PageView,              locations.ts   reads the stored
            @seqno/outliner + EditorSlot                           folder handle / OPFS dir
            (@seqno/editor)
```

- **Shell and routes** (TanStack Router, code-based): journals home `/`, page by name `/page/$name`, `/all-pages`, and `/search?q=` (search params decoded with Effect Schema through `Schema.toStandardSchemaV1`). Left sidebar has journals, all pages, search and favorites. The right sidebar can be toggled and holds a placeholder for linked references. Styling is neutral, uses CSS variables, and follows the system light or dark setting.
- **React 19 with React Compiler** through `@rolldown/plugin-babel` + `babel-plugin-react-compiler` (the stable Babel route in `@vitejs/plugin-react` 6). No `useEffect` anywhere.
- **Core worker bootstrap**: `src/worker/main.ts` serves `CoreRpcs` over `RpcServer.layerProtocolWorkerRunner`. `StubCore` implements every RPC on in-memory state:
  - Commands: `CreatePage`, `RenamePage`, `DeletePage`, `InsertBlock`, `EditText`, `SetCollapsed`, `DeleteBlocks`, `SetProperty`. These return the right `GraphEvent`s.
  - `SplitBlock`, `MergeWithPrevious`, `Indent`, `Outdent`, `MoveBlocks`, `Undo` and `Redo` return `CommandRejected` ("@seqno/graph implements it").
  - `WatchPage` and `WatchQuery` are live: they re-emit only when their result changes. `WatchQuery` is a plain substring search for now.
- **State with `@effect/atom-react`**, in `src/atoms.ts`: the page list and its derived journals, favorites and pages by name, live search, and `dispatch` (`concurrent: true`, refreshes the page list when a page event comes back). The whole app layer sits in one atom, `appLayer`; tests swap it for an in-process core through `AtomRegistry.make({ initialValues })`. Page trees and per-block state now live in `@seqno/outliner`.
- **Open-graph flow**:
  - "Open a folder" uses `showDirectoryPicker`.
  - "Open the demo graph" creates `graphs/demo` in OPFS.
  - Either way the location is saved in IndexedDB (`seqno` / `graphs`, keyed by graph name), and recent graphs are listed on the open screen.
  - The worker reads the same record: it checks folder permission or that the OPFS folder exists, then opens the graph. This proves a `FileSystemDirectoryHandle` saved by the window can be read in the worker.
- **Outliner and editor**: pages render through `@seqno/outliner`, and the focused block edits through `@seqno/editor`, joined by `ui/EditorSlot.tsx` (see Integration below).

## How to run

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm check
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm exec vitest run --project @seqno/web
pnpm --dir apps/web dev        # http://localhost:5173, Chrome or Edge
pnpm --dir apps/web build      # dist/, the worker is emitted as its own chunk
```

The tests are 8 Vitest tests:

- `src/worker/test/stub-core.test.ts` drives the stub core through `RpcTest.makeClient`: open, insert, edit, live page stream, delete subtree, live search, rejection.
- `test/atoms.test.ts` drives the real atoms through an `AtomRegistry`: open graph, journals order, favorites, page by name, notifications per block, collapsed rows.

I ran the browser check with a throwaway Playwright script against `vite preview`. `tools/e2e` owns the real harness.

## Integration points

- **Swap in the real core**: in `src/worker/main.ts`, replace `StubCore` and `BrowserGraphLocations` with layers built on graph, index and vault. Everything else in the worker stays the same.

## Additions to the contract (for integration to reconcile)

- **`GraphLocation`** (`FolderGraph { name, handle } | OpfsGraph { name }`) and the IndexedDB record behind it are defined twice: `src/graph-locations.ts` (UI) and `src/worker/locations.ts` (worker). The import-boundary rule forbids UI files and `src/worker/**` from importing each other, so they cannot share it. Suggestion: move `GraphLocation` into `@seqno/rpc`. `OpenGraph.graph` is the graph name, which is the key into that store.
- **Worker tests live in `src/worker/test/`**, not `apps/web/test/`. Files in `apps/web/test` count as UI side, so lint would reject their imports of worker code.
- **Favorites** are the page property `favorite: "true"`, set with `SetProperty`. Logseq keeps favorites in `config.edn`, so interop may want a different home.
- **`InsertBlock` without `after`** makes the block the first child in the stub. The contract does not say; `@seqno/graph` should pick and document it.

## Decisions and gotchas worth a look

- **The worker RPC pool allows one call at a time by default.** `RpcClient.layerProtocolWorker` defaults to one in-flight call per worker, so the first live `WatchPage` blocked every later `Dispatch` until I raised it (`src/core.ts`).
- **The atom registry does not compute a value just because something subscribes.** `registry.subscribe` without `{ immediate: true }` never computes a derived atom that hasn't been read yet, so the subscriber is never notified. React hooks always read first, so the app is fine, but tests must pass `immediate`.
- **No COOP/COEP headers yet.** sqlite-wasm's opfs-sahpool does not need `SharedArrayBuffer`. Add the headers to `vite.config.ts` if integration wants the precise timers the web-perf spike used.
- **Files outside `apps/web`**: `pnpm install` added `minimumReleaseAgeExclude: [vite@8.3.3]` to `pnpm-workspace.yaml`, because vite 8.3.3 is newer than the release-age gate. `pnpm-lock.yaml` changed too.

## Known gaps

- **Folder graphs**: the stub does not read folder contents. It checks permission and opens a graph with only an empty journal for today. Reading the files is vault's job.
- **Recent folders after a restart**: reopening one asks for permission again, as Chrome requires. A folder named `demo` would overwrite the demo graph's record.
- **Journals page** renders every journal page, each with its own outliner.
- **Search**: page hits are matched in the UI against the page list. Block hits come from the stub's substring search until `@seqno/query` and `@seqno/index` land.
- **Errors**: a rejected `Dispatch` is kept in the `dispatch` atom but not shown anywhere yet.

## Integration (phase1/integrate-app)

`phase1/web`, `phase1/outliner`, `phase1/editor` and `phase1/e2e` are merged, in that order, and wired together.

```
 PageView ── <Outliner pageId zoom onNavigate editor={EditorSlot}>
                 │ reads pageTreeAtom (WatchPage)       writes dispatchAtom (Dispatch)
                 └─ EditorSlot ── <BlockEditor> (CodeMirror, one per focused block)
                       SplitBlock / MergeWithPrevious / Indent / Outdent ─► onIntent
                       EditText / Undo / Redo                            ─► dispatch
                       ToPrevious / ToNext                               ─► FocusPrevious / FocusNext
                       Escape                                            ─► Exit
                       textUpdates = pageTreeAtom → this block's text, deduped
                       searchPages / searchBlocks = pages atom / WatchQuery
```

- **One core client.** `CoreClient` moved from `@seqno/outliner` into `@seqno/rpc`. `main.tsx` sets `coreRuntime.layer` to `Layer.orDie(WorkerCore)`, the same layer value `appLayer` uses. Atom runtimes share one memo map per registry, so the app and the outliner talk to one worker.
- **Mount-once editor vs. render-time intents.** The editor reads its host once at mount; the outliner's `onIntent` was a render-time closure, so a Split typed into a block that was empty at mount would have outdented it. `onIntent` now reads the current page tree from the registry when it runs.
- **Routes**: `/page/$name?zoom=<blockId>` drives the outliner's zoom; bullets and breadcrumbs navigate there. Each page is an `<article>` labelled by its `h1`, the markup the e2e flows rely on.
- **Removed**: `OutlinerPlaceholder`, `EditorPlaceholder`, `text-edit.ts`, the per-block atoms (`pageTree`, `rows`, `block`, `focusedBlock`) and the test that covered them.
- **Versions**: one React for the app, 19.3.0 (the outliner had pinned 19.2.8). `@effect/atom-react` 4.0.1 keeps its own `scheduler` 0.27.0 peer; vite is 8.3.3 everywhere in the UI.
- **Test memory**: root vitest runs 2 workers and the outliner's browser-mode project runs in a later group (`sequence.groupOrder: 1`). Run in parallel, the full suite was OOM-killed inside the 1.5 GB scope; now `pnpm check` peaks around 1.2 GB.

Run it:

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm check                      # 95 tests
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm --filter @seqno/e2e test  # 6 pass, 1 fixme
```

Known gaps after integration:

- **The worker still runs `StubCore`.** graph, index and vault are merged on `phase1/integrate-core`, not here; swapping them into `src/worker/main.ts` is the next integration step. Until then `SplitBlock`, `MergeWithPrevious`, `Indent`, `Outdent`, `MoveBlocks`, `Undo` and `Redo` are rejected by the stub, so Enter, Tab and drag do nothing visible in the running app, and `reload keeps text` stays `fixme`.
- **Folder graphs in headless Chrome**: clicking "Open a folder" with the e2e harness's seeded OPFS picker closes the page, so the journal flows open the demo graph. The demo journal already has text, so `type in a block` appends to its first block.
- **Caret column across blocks**: the editor reports `ToPrevious`/`ToNext` with a cursor placement, but the outliner's intents carry none, so moving up lands at the end of the previous block and moving down at the start of the next.
- **No search RPCs**: `[[`/`#` completion filters the page list in the UI and `((` uses `WatchQuery`'s first result. Real `SearchPages`/`SearchBlocks` RPCs should come from `@seqno/index`.
- **The first browser-mode run after an install** re-optimizes Vite deps and has been OOM-killed once at the 1.5 GB cap; a rerun passes.
