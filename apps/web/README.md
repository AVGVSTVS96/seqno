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
| `src/ui/hints/`                        | Tips that point at real controls in the demo graphs, placed in empty space and shown once you are idle.      |
| `src/ui/EditorSlot.tsx`                | Mounts `@seqno/editor` inside `@seqno/outliner` rows.                                                        |
| `src/worker/`                          | `RealCore`: serves `CoreRpcs` and `PageRpcs`, takes one Web Lock per graph, runs one session per open graph. |

A session (`src/worker/session.ts`) syncs the vault into an empty graph, imports the folder's Logseq markdown when there is no edit log yet, adds today's journal, then saves every 250 ms and syncs every 5 s. Every event batch also goes into the index.

The two demo graphs live in OPFS as `demo` (Getting started, `src/worker/demo.ts`) and `developer` (Developer graph, `src/worker/developer.ts`). A first visit shows a chooser between them before anything opens; later visits reopen the last graph.

The homepage embeds the app in an iframe with `?embed` (`src/embed.ts`). Embedded, it skips the chooser and opens Getting started, leaves out folder picking and About seqno (a cross-site frame can't show a folder picker), and posts `{ type: "seqno:ready" }` to the parent each time a graph opens. Its storage is partitioned under the homepage, so the embedded demo is a copy separate from the one at seqno-app.vercel.app.

Each demo graph has a content version, set next to its starter in `src/worker/browser.ts`:

```ts
["developer", { version: 1, files: developerGraph }],
```

The session stamps the version into the graph's folder (`starter-version`). When the shipped version differs from the stamp, it clears the folder and writes the fresh starter, so returning visitors get new content and lose their demo edits. Bump the number whenever a starter changes. Folders you pick never have a starter, so this never touches your own graphs. A demo folder with markdown but no edit log yet (a seeded fixture) is imported as it is and stamped.

Files under `src/worker/` may import core packages; everything else here may not, and starts the worker with `new Worker(new URL(...))`.

## Run it

```sh
pnpm --filter @seqno/web dev    # shows the demo graph chooser on first visit
pnpm test --project @seqno/web
```

## Known gaps

- Opening isn't lazy: every open merges the whole edit log into an empty graph and refills an in-memory index.
- The markdown mirror isn't wired in: editing a picked Logseq folder writes its edit log, but its `.md` files don't change.
- Edits from the last 250 ms before the tab closes can be lost; nothing saves on page hide.
