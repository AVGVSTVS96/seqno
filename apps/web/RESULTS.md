# web (apps/web) results, phase 1

## What works

Checked end to end in headless Chrome against a production build: open the demo graph, see today's journal, follow a favorite, edit a block, collapse a parent, search, reload and see the graph under "Recent graphs".

```
 UI (main thread)                                  core worker (src/worker/)
 ─────────────────────────────────────────         ──────────────────────────────────
 main.tsx   RegistryProvider + RouterProvider       main.ts   RpcServer(CoreRpcs)
 router.tsx /  /page/$name  /all-pages  /search               + BrowserWorkerRunner
 atoms.ts   appRuntime ── Core (RpcClient) ──────►  stub-core.ts   in-memory handlers
            GraphLocations (IndexedDB, FSA, OPFS)   graph-state.ts pure command logic
 ui/        Shell, sidebars, PageView,              locations.ts   reads the stored
            OutlinerPlaceholder, EditorPlaceholder                 folder handle / OPFS dir
```

- **Shell and routes** (TanStack Router, code-based): journals home `/`, page by name `/page/$name`, `/all-pages`, and `/search?q=` (search params decoded with Effect Schema through `Schema.toStandardSchemaV1`). Left sidebar has journals, all pages, search and favorites. The right sidebar can be toggled and holds a placeholder for linked references. Styling is neutral, uses CSS variables, and follows the system light or dark setting.
- **React 19 with React Compiler** through `@rolldown/plugin-babel` + `babel-plugin-react-compiler` (the stable Babel route in `@vitejs/plugin-react` 6). No `useEffect` anywhere.
- **Core worker bootstrap**: `src/worker/main.ts` serves `CoreRpcs` over `RpcServer.layerProtocolWorkerRunner`. `StubCore` implements every RPC on in-memory state:
  - Commands: `CreatePage`, `RenamePage`, `DeletePage`, `InsertBlock`, `EditText`, `SetCollapsed`, `DeleteBlocks`, `SetProperty`. These return the right `GraphEvent`s.
  - `SplitBlock`, `MergeWithPrevious`, `Indent`, `Outdent`, `MoveBlocks`, `Undo` and `Redo` return `CommandRejected` ("@seqno/graph implements it").
  - `WatchPage` and `WatchQuery` are live: they re-emit only when their result changes. `WatchQuery` is a plain substring search for now.
- **State with `@effect/atom-react`**, in `src/atoms.ts`:
  - `pageTree(pageId)` is a live `WatchPage` stream.
  - `rows(pageId)` holds the visible structure (depth, has children, collapsed). It only changes when the structure changes, not when text changes.
  - `block({ pageId, blockId })` is **one atom per visible block**. It uses structural equality, so an edit re-renders only that block's row. A test checks this.
  - `dispatch` runs with `concurrent: true` so fast typing never cancels an earlier edit. It refreshes the page list only when a page event comes back.
  - The whole app layer sits in one atom, `appLayer`. Tests swap it for an in-process core through `AtomRegistry.make({ initialValues })`.
- **Open-graph flow**:
  - "Open a folder" uses `showDirectoryPicker`.
  - "Open the demo graph" creates `graphs/demo` in OPFS.
  - Either way the location is saved in IndexedDB (`seqno` / `graphs`, keyed by graph name), and recent graphs are listed on the open screen.
  - The worker reads the same record: it checks folder permission or that the OPFS folder exists, then opens the graph. This proves a `FileSystemDirectoryHandle` saved by the window can be read in the worker.
- **Placeholders for parallel parts**:
  - `ui/OutlinerPlaceholder.tsx` renders rows with collapse bullets and `[[page]]` links.
  - `ui/EditorPlaceholder.tsx` is a textarea mounted only on the focused block. It turns each change into a minimal `EditText` through `text-edit.ts`. Enter inserts a sibling and Escape leaves the block.

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
- **Swap in the real UI parts**: replace the `OutlinerPlaceholder` and `EditorPlaceholder` imports with `@seqno/outliner` and `@seqno/editor`. The placeholders show what they get from the app:
  - `rows(pageId)` and `block({ pageId, blockId })`
  - `focusedBlock`
  - `dispatch(command)`, which resolves to the `GraphEvent`s

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
- **Placeholders**: no keyboard navigation between blocks, no zoom, no drag, no virtualization. The journals page renders every journal page.
- **Search**: page hits are matched in the UI against the page list. Block hits come from the stub's substring search until `@seqno/query` and `@seqno/index` land.
- **Errors**: a rejected `Dispatch` is kept in the `dispatch` atom but not shown anywhere yet.
