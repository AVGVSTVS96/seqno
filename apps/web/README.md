# @seqno/web

The Vite web app for Chrome and Edge: React UI on the main thread (UI side), and the core worker in `src/worker/` (core side) that runs graph, vault, index and import behind `@seqno/rpc`.

## What's inside

| Path                                   | What it holds                                                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`, `src/router.tsx`       | Entry and routes: `/` (journals), `/page/$name?zoom=`, `/all-pages`, `/graphs`, `/search`.                                                                                         |
| `src/atoms.ts`                         | App state through `@effect/atom-react`: the open graph, page list, favorites, theme, sidebars.                                                                                     |
| `src/core.ts`                          | `WorkerCore` and `WorkerPages`, the RPC clients for the core worker.                                                                                                               |
| `src/ui/Shell.tsx`, `src/ui/shell/`    | Header, left and right sidebars, menus, dialogs, settings, export, keyboard shortcuts.                                                                                             |
| `src/ui/PageView.tsx`, `src/ui/pages/` | Page title and properties, linked and unlinked references, journals, the all pages table.                                                                                          |
| `src/ui/search/`                       | The Mod+K search palette.                                                                                                                                                          |
| `src/ui/hints/`                        | Tips that point at real controls in the demo graphs, placed in empty space and shown once you are idle.                                                                            |
| `src/ui/EditorSlot.tsx`                | Mounts `@seqno/editor` inside `@seqno/outliner` rows.                                                                                                                              |
| `src/worker/`                          | `RealCore`: serves `CoreRpcs` and `PageRpcs`, a SharedWorker every tab talks to; takes one Web Lock per graph, runs one session per open graph for all the tabs that have it open. |

A session (`src/worker/session.ts`) syncs the vault into an empty graph, imports the folder's Logseq markdown when there is no edit log yet (the `OpenGraph` that imported returns the files it left out or changed in `skipped`, and the app lists them in a notice), adds today's journal, then saves as soon as an edit lands (one write at a time; edits made during a write go in the next) and syncs every 5 s. `WatchSaveState` streams saved, unsaved or failed with the reason; the header shows a dot while a save takes longer than 400 ms and "Not saved" when one fails, and closing a tab after a failed save asks first. Every event batch also goes into the index.

The index is in-memory SQLite, saved as one file per graph in OPFS (`indexes/<graph>.sqlite`, for picked folders too) with the Loro version it reflects. Opening loads that file and re-indexes only the pages changed since, or fills from the graph when there is no file or its version isn't in the edit log. The file marks the pages it doesn't hold yet, so a fill saved part-way (when the tab closes, and each time the pages it wrote double) goes on from there. It is saved after a fill or catch-up, when index writes go quiet and re-indexing what changed since the last save would take longer than a save, and when a tab closes (each tab lets go of its Web Lock on `pagehide`, so the worker hears at once). The tabs start the worker with `extendedLifetime`, so it outlives a closed or reloaded last tab long enough to finish saving (up to 30 s in Chrome). Only a graph still in the list gets its index saved. Removing a graph from the list (`ForgetGraph`) deletes its index file, and the worker deletes every index file whose graph isn't listed when it starts and on each removal.

The two demo graphs live in OPFS as `demo` (Getting started, `src/worker/demo.ts`) and `developer` (Developer graph, `src/worker/developer.ts`). A first visit shows a chooser between them before anything opens; later visits reopen the last graph.

The homepage embeds the app in an iframe with `?embed` (`src/embed.ts`). Embedded, it skips the chooser and opens Getting started, leaves out folder picking and About seqno, doesn't change which graph the app resumes, and posts `{ type: "seqno:ready" }` to the parent each time a graph opens, and `{ type: "seqno:escape" }` for each Escape the app doesn't use itself (handlers that use one call `preventDefault`, and open dialogs and popovers close on their own), so the homepage can close full screen. It runs on the homepage's own origin, so it shares graphs, settings and the core worker with the app open in other tabs.

Each demo graph has a content version, set next to its starter in `src/worker/browser.ts`:

```ts
["developer", { version: 1, files: developerGraph }],
```

The session stamps the version into the graph's folder (`starter-version`). When the shipped version differs from the stamp, it clears the folder and writes the fresh starter, so returning visitors get new content and lose their demo edits. Bump the number whenever a starter changes. Folders you pick never have a starter, so this never touches your own graphs. A demo folder with markdown but no edit log yet (a seeded fixture) is imported as it is and stamped.

Files under `src/worker/` may import core packages; everything else here may not, and starts the worker with `new SharedWorker(new URL(...))`.

## Hosting

The app lives at [seqno.vercel.app/app](https://seqno.vercel.app/app/), on the homepage's origin. Vercel builds it with base `/app/` into `dist/app` (`vercel.json` at the repo root), and the homepage project rewrites `/app/*` to this project. Requests that reach `seqno-app.vercel.app` directly, without the homepage's `x-forwarded-host`, redirect to the same path under `seqno.vercel.app/app/`. Local dev and the tests run at `/`; the router takes its basepath from Vite's `BASE_URL`.

## Run it

```sh
pnpm --filter @seqno/web dev    # shows the demo graph chooser on first visit
pnpm test --project @seqno/web
```

## Known gaps

- Opening still merges the whole edit log into an empty graph, and reads every page root for the page list.
- The markdown mirror isn't wired in: editing a picked Logseq folder writes its edit log, but its `.md` files don't change.
