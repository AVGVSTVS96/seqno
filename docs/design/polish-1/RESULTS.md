# Polish, round 1: results

This round worked through the critic's findings against Logseq 2.x (test.logseq.com) and classic (demo.logseq.com), majors first. Every fix was checked in a headless Chrome next to the reference app, and the scenes in `tools/e2e/design` were captured again at the end. Where the merged UI stands scene by scene is in `docs/design/UI.md`.

## What was wrong, and what it does now

### Majors

| Finding                           | Now                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl+Z after a reload wiped pages | `@seqno/graph` restarts its UndoManager whenever a merge moves this peer's counter, so merged update files never become an undo step. One Ctrl+Z after a reload undoes only the last edit.                                                                                                                 |
| Every load stopped on All graphs  | The app remembers the last graph (`seqno.lastGraph`) and opens it before the first render, showing the shell while it loads; a first visit opens the demo graph, like test.logseq.com. Reloads and deep links keep their route. All graphs is a page in the shell at `/graphs`, reached from the switcher. |
| Pasting an outline made one block | The editor reads pasted markdown with the import's outline parser and inserts the blocks with nesting and properties, through a new `InsertBlocks` command (one commit, one undo step). Works in block selection too.                                                                                      |
| No preview on hover               | Resting on a page ref, tag or block ref for 1s opens a 610px preview below (or above) it, closing 0.8s after the pointer leaves. Measured against `.ls-preview-popup`.                                                                                                                                     |
| No bullet context menu            | Right-clicking a bullet selects the block and opens 2.x's 280px menu at the pointer: colors, headings, Open in sidebar, Copy block ref / embed, Copy / Export as.., Cut, Delete selected blocks, Toggle number list, Expand / Collapse all. Positions measured from 2.x to the pixel.                      |
| Properties vanished while editing | The editor shows `key:: value` lines under the first line, like classic, and splits edits back into EditText and SetProperty with a byte-exact round trip. Page properties are edited the same way.                                                                                                        |
| `#gre` missed tag-only pages      | Pages that exist only as references come from the index (`WatchReferencedPages`) and show in `[[`, `#`, the palette (no Create offer), All pages and Recent.                                                                                                                                               |
| New page from search had no caret | Creating a page from the palette or the missing-page placeholder adds its first block and opens the editor in it (shared `editRequest` atom in the outliner).                                                                                                                                              |

### Minors and nits

| Finding                            | Now                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Undo past a page's creation        | Page events from any dispatch refresh the page list, so the view falls back to the missing page and redo brings it back; the load failure is visible now. |
| Clicking inside a code block       | A CodeMirror editor opens in the same Solarized frame (gutter, language label, active line); the block keeps its height.                                  |
| Slash menu marks                   | Plain labels, as in 2.x.                                                                                                                                  |
| `((` popup ran off the window      | Popups are capped at 600px (slash 480px) and the room on the roomier side, so they flip above.                                                            |
| Back lost the scroll position      | The shell remembers the main column's scroll per history entry and restores it once the content is tall enough.                                           |
| `localhost/#` bubble on refs       | Refs, tags, markers, priorities, property keys, crumbs and the logbook total are `role=link` without `href`.                                              |
| Tab title and favicon              | Tabs are titled after the page, the zoomed block, All pages or Graphs (`seqno` on journals); seqno has its own favicon.                                   |
| Rule under the last journal        | The 1px rule only sits between journals.                                                                                                                  |
| Header ⋯ menu                      | Export page and Settings added in 2.x's positions; Settings is the two-pane dialog with General and Keymap.                                               |
| Palette footer and memory          | Copy ref (Mod+C), medium weight, 2.x's right edge, active Create; the last query comes back selected.                                                     |
| Per-block reference counts         | Classic's badge at the right of referenced blocks, from a new `WatchBlockRefCounts` RPC.                                                                  |
| Fast Enter, Backspace, typing      | A merge made while held keys replay keeps holding the rest for the merged block's editor.                                                                 |
| Breadcrumb, ref gap, sidebar card  | 25.6px crumbs, 1px gap after `[[`, 2.x's space under sidebar block cards.                                                                                 |
| Code token colors                  | Member dots and property-name values are plain.                                                                                                           |
| Empty `[[` rows, scattered matches | Ten relative-date rows; scattered-letter page matches drop out when closer matches exist; `#` offers New tag.                                             |
| Recent list and switcher           | Zooms don't add to Recent, tag-only pages do; the switcher trigger loses its hover color while open and gains an All graphs row.                          |
| Index tags (found on the way)      | Tags inside fenced code, trailing dots and `#+BEGIN_QUERY` are no longer page refs; `alias::` lists are read item by item.                                |

## What doesn't match yet

- **Multi-block selection toolbar** (optional finding): not built. Copy, Delete and the block menu work from the keyboard and the bullet's right-click.
- **Linked references toolbar** (filters, sort, search on hover): not built; it needs reference filters in the index.
- **Property order** still follows the Loro map, not the file, both in the properties box and in the editor's draft.
- **Block menu** leaves out 2.x's DB-graph rows (comment, reaction, icon) and Make a Flashcard; heading icon 7 is Tabler's plain H, not Logseq's own.
- **Export** offers Text only (no OPML, HTML, EDN or the option checkboxes).
- **Settings** has General and Keymap only.
- **Previews** show a page's blocks, not its properties box.
- **Peer ids** are still fixed per device (the hardening pass owns them); the undo fix is the guard the finding asked for.

## New tokens

Added in component CSS, not `theme.css`:

- `features/outliner/src/outliner.css`: `--bg-highlight-{yellow,red,pink,green,blue,purple,gray}` (Logseq's highlight colors, light and dark, measured), `--bg-code-active-line`.
- `apps/web/src/ui/shell/shell.css`: `--swatch-{yellow,…,gray}` (the block menu's swatches, measured from 2.x).

## Contract changes

- `@seqno/domain`: `InsertBlocks` command and `BlockDraft`.
- `@seqno/rpc`: `WatchBlockRefCounts` (CoreRpcs), `WatchReferencedPages` and `ReferencedPage` (PageRpcs).
- `@seqno/syntax`: `splitProperties`, `joinProperties`, `draftOffset`, `textOffset`, `pastedBlocks`, `isSingleLine`; Code bodies carry `codeFrom`.
- Watches (`following` in the worker) wait for a graph instead of failing with GraphNotOpen when they start first.

## Scenes compared

`journals`, `page`, `showcase-top`, `showcase-lower`, `editing`, `autocomplete`, `slash`, `search`, `right-sidebar`, `left-sidebar-collapsed`, `all-pages`, each light and dark, plus one-off probes against the live apps for All graphs, the graph switcher, the bullet menu, block colors, previews, the more menu, Settings, Export page, the palette footer and the reference count badge.

## How to check it

```sh
pnpm --filter @seqno/web build && pnpm --filter @seqno/web preview --port 4189 --strictPort
cd tools/e2e
SEQNO_E2E_BASE_URL=http://localhost:4189/ pnpm exec playwright test   # all flows
SEQNO_E2E_BASE_URL=http://localhost:4189/ pnpm design                 # every scene, both apps
```

Wrap each in `systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0`.

New flows: `flows/startup.e2e.ts` (last graph on load, All graphs in the shell, Ctrl+Z after a reload, Back keeps the scroll), `flows/blocks.e2e.ts` (bullet menu, paste, hover preview, code editing), and in `pages.e2e.ts` / `editor.e2e.ts`: new page caret, tag suggestions, block and page properties, Export and Settings, machine-speed Enter / Backspace.

| Suite                    | Result                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| `pnpm check`             | lint, format and typecheck clean; vitest 456 passed in 37 files     |
| Playwright (`tools/e2e`) | 43 passed, 2 skipped (the on-demand screenshot flows), against 4189 |
| Design harness           | all 11 scenes, both apps, light and dark; no missing steps reported |
