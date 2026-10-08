# @seqno/web

The Vite web app for Chrome and Edge: React UI on the main thread (UI side), and the core worker in `src/worker/` (core side) that runs graph, vault, index and import behind `@seqno/rpc`.

## What's inside

| Path                                   | What it holds                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/main.tsx`, `src/router.tsx`       | Entry and routes: `/` (journals), `/page/$name?zoom=`, `/all-pages`, `/graphs`, `/search`.                   |
| `src/atoms.ts`                         | App state through `@effect/atom-react`: the open graph, page list, favorites, theme, sidebars.               |
| `src/core.ts`                          | `WorkerCore` and `WorkerPages`, the RPC clients for the core worker.                                         |
| `src/ui/Shell.tsx`, `src/ui/shell/`    | Header, left and right sidebars, menus, dialogs, settings, export, keyboard shortcuts.                       |
| `src/ui/PageView.tsx`, `src/ui/pages/` | Page title and properties, linked and unlinked references, journals, the all pages table.                    |
| `src/ui/search/`                       | The Mod+K search palette.                                                                                    |
| `src/ui/EditorSlot.tsx`                | Mounts `@seqno/editor` inside `@seqno/outliner` rows.                                                        |
| `src/worker/`                          | `RealCore`: serves `CoreRpcs` and `PageRpcs`, takes one Web Lock per graph, runs one session per open graph. |

A session (`src/worker/session.ts`) syncs the vault into an empty graph, imports the folder's Logseq markdown when there is no edit log yet, adds today's journal, then saves every 250 ms and syncs every 5 s. Every event batch also goes into the index.

Files under `src/worker/` may import core packages; everything else here may not, and starts the worker with `new Worker(new URL(...))`.

## Run it

```sh
pnpm --filter @seqno/web dev    # opens the demo graph on first visit
pnpm test --project @seqno/web
```

## Known gaps

- Opening isn't lazy: every open merges the whole edit log into an empty graph and refills an in-memory index.
- The markdown mirror isn't wired in: editing a picked Logseq folder writes its edit log, but its `.md` files don't change.
- Edits from the last 250 ms before the tab closes can be lost; nothing saves on page hide.
