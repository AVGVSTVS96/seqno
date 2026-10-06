# Pages and search: results

Logseq's page view, journals, all pages table and search palette, plus one tab per graph. Measured against Logseq 2.x (test.logseq.com) for everything the two versions share, and Logseq classic (demo.logseq.com) for markdown page properties, at 1440×900 in light and dark with `getComputedStyle` and side-by-side screenshots.

```
 router.tsx              root: graph-in-use screen, or Shell + SearchPalette
 ui/PageView.tsx         title, page properties, blocks, references; PageByName, missing pages
 ui/routes.tsx           route components
 ui/pages/
   PageTitle.tsx         36px title, click (or Enter) to rename in place
   PageProperties.tsx    page properties drawn as the first block, like classic
   References.tsx        Linked references, Unlinked references, references to a missing page
   mentions.ts           marks the page's name in unlinked references (CSS Highlight API)
   Journals.tsx          today first, more days mounted as you scroll
   AllPages.tsx          Logseq 2.x's table
   GraphInUse.tsx        "This graph is open in another tab"
   atoms.ts, model.ts    page RPC atoms, table settings, pure helpers
 ui/search/
   SearchPalette.tsx     Mod+K palette (native <dialog>)
   atoms.ts, model.ts    query, hits, groups, highlighting, the Mod+K listener
 worker/                 page RPC handlers, Web Lock per graph, per-page change notices
 packages/rpc pages.ts   PageRpcs
 packages/index          live backlinks, unlinked mentions, page stats
```

## What matches Logseq now

**Page** [2x]

- Title 36px / 54px / 500 at x = 381, a 58px row, 48px to the first block, blocks 20px left of the title. Clicking the title turns it into a textarea with the same metrics and the caret where you clicked; Enter or blur renames (`RenamePage`) and follows the new URL, Esc cancels, a rejected name shows the reason under the title. Journal titles aren't editable on their page and link to the day in the journals list.
- Page properties [classic]: the first row, with its own bullet; the box is `--bg-properties`, 4px 8px padding, 4px margin, radius 4px; each line 24px, the key a 500-weight link in `--fg-property-key`, the colon normal weight with 4px after it, `alias` and `tags` values as bare links, other values with `[[ ]]` links.
- Pages that exist only as references (tags, `[[x]]` with no file) show the title, a faint empty bullet that creates the page, and their linked references.

**Linked references** [2x]

- 92px below the last block (Logseq's 28px add-button row plus its 64px margin), 4px in from the title. Header row 28px: "Linked references" 14px / 20px / 500 in `--fg`, the count 12px / 16px / 500 in `--fg-subtle`, 4px apart. The fold caret sits 27px left of the header (22px box, 2px padding, 1px down, `--fg-control` at 0.4), shown on hover and always when folded, rotating 90° in 100ms ease-in; hovering it lifts it to 1.
- Body: 4px down, a 1px `--border` top line, 8px padding, groups 8px apart. Group header 24px, the page as a 16px link in `--fg-link`, its own fold caret. Blocks sit 8px left of the group (bullets at x = 397), each 4px below the previous element, rendered by the real outliner (editable, with children).
- Breadcrumbs above nested hits: 14px / 20px at 0.7 (1 on hover), 24px in, links in `--fg-control` capped at 28ch with an ellipsis, `/` at 0.5 with 4px padding. Shift-click opens a crumb in the sidebar.
- When a block and its child both link the page, only the outer block is listed (the child shows inside it).
- Unlinked references: only shown when there are some, folded by default, no count (as 2.x), the same layout; the page's name and aliases are marked word by word in each mentioning block (`--bg-mark` / `--fg-mark`, no padding). A 32px gap separates the two sections, which also keeps journal heights identical to 2.x.
- Pixel checks: section header, count, caret, body line, group headers and first rows land on Logseq's coordinates (x 356 / 382 / 397, y offsets 2, 4, 8, 24) in the `page` scene, light and dark.

**Journals** [2x]

- Each day: min-height 500px, 102px bottom padding, 1px `--border` bottom line; days stack exactly as in 2.x (529px for today's showcase journal, 500px for Oct 5th). Linked references under each day.
- Lazy: the first 3 days render, an `IntersectionObserver` (on a sentinel, through a ref callback, 1200px ahead with `scrollMargin` so it also works inside the shell's scroll container) mounts 3 more each time it comes near. Future journal pages are left out, like Logseq.

**All pages** [2x]

- Wide layout (the content column switches to `--content-max-width-wide`: x = 278 to 1424). View header 28px: table icon, "All", the count in `--fg-subtle`; the actions at the right at 0.75 (1 while the header is hovered), 24px buttons with 18px icons in `--fg-subtle`, hover `rgb(244 244 245 / 0.7)` / `#004152` with a darker icon.
- Table: 32px gutter, Page name 360, Backlinks 180, Tags 180, Created At 160, Updated At 160, then the rest. Header 34px with 1px top and bottom lines, cells 14px / 20px / 500 in `--fg-subtle`, `--fg-strong` on hover, each with a 1px right line. Rows 33px with a bottom line, 8px cell padding, hover `rgb(241 245 249 / 0.5)` / `rgb(0 53 66 / 0.5)`. Page names in `--fg-link` (light) / `--fg` (dark), as 2.x; tags as `#tag` links at 0.7. Times as `2026-10-06 14:17`.
- Click a header to sort (arrow icon on the sorted column; click again to flip); the search action opens Logseq's 244×28 "Type to search" box with an × to close; a calendar toggle hides or shows journals. Sort and the journals toggle persist.

**Search palette** [2x]

- `Mod+K` (also while editing), the header search button, or `/search`. A native modal `<dialog>`: 896px (90dvw max) plus border, top at 125px at any window height, `--bg-popover`, 1px `--border`, radius 8px, `--shadow-dialog`; the backdrop is `--bg-overlay`; both fade and scale in from 0.95 over 150ms.
- Input row 53px, `--bg-input`, 1px `--border-input` line, 20px / 28px text, 12px padding, placeholder "What are you looking for?" in `#6b7280`; it reopens with the last query selected, like 2.x.
- Results: a 65dvh scroll area with 56px bottom padding, `#f8f8f8` in light. Groups split by a 1px line: a "Create page — Create page called '…'" row when no page or alias has that name (active first, as in 2.x), "Nodes" (pages, then blocks, 10 shown), "Recently updated" (pages whose title matches, newest first, 5 shown; with no query it lists the most recent pages). Group headers 32px, 12px bold `--fg-muted` title and an 11.2px count; "Show more Ctrl ↓" in `--fg-control` at 0.5 when a group is cut, `Mod+↓` toggles it.
- Rows: 2px side margin, 6px 12px padding, radius 8px, 32px (46px for a block, with a 12px light-weight breadcrumb line of page / parents, each part capped at 18ch). A 20×20 icon tile (radius 4px, `--bg-icon-tile`): file for pages, a dot for blocks, square-plus for Create. Titles 14px / 20px / 500 in `--fg-palette-item`; every query word is marked (`--bg-mark`, no padding). Active row: `--bg-palette-active` with Logseq's 1px inset edge in light.
- ↑ ↓ (or Ctrl+P / Ctrl+N) move and scroll the active row into view, hovering moves it, Enter opens (a block opens zoomed on its page), Shift+Enter or Shift-click opens in the right sidebar, Esc, a backdrop click or Mod+K closes. Closing a palette opened at `/search` goes back to the previous page.
- Footer: `--bg-footer`, a 1px top line, 8px 12px padding: "Tip:" and a tip line at 0.5 with kbd chips; at the right, "Open ⏎" and "Open in sidebar ⇧ ⏎" (or "Create ⏎") at 0.4, full on hover.
- Dark: Logseq dims the input row and the groups to 0.6 and drops the results background; seqno does the same.

**One tab per graph**

- The worker takes a Web Lock (`seqno/graph/<name>`, `ifAvailable`) before opening a graph and holds it for the session. A second tab gets `GraphLocked`, shows "This graph is open in another tab" (laid out like the shell's All graphs screen) and asks for the lock again, waiting; when the first tab closes, the second opens the graph by itself. "Open another graph" leaves the queue. 2.x itself allows several tabs, so this screen has no Logseq reference.

## Performance

- `WatchPage` used to re-read every watched page on every keystroke (every mounted journal, every reference group). The worker now records which pages each batch of events touched, including the page a moved block left, and a page watch wakes only for its own page.
- Backlinks streams re-read only when a ref to one of the page's names changes (`ref:<name>` keys), a page is renamed or a block moves pages; unlinked mentions on text edits; page stats on edits while all pages or the palette is open. Every stream drops updates with the same blocks.
- Journals mount a few days at a time (above).

## What doesn't match yet

- Page properties show in the core's key order (Loro map), not the file's (Garden Plan shows plot, alias; Logseq alias, plot). Needs the graph to keep an order.
- Missing pages show their title lowercase (only the normalized name is known).
- 2.x's palette also has Commands and Filters groups, "Copy ref", and "Ctrl ⏎ opens search in the sidebar". seqno has no commands or filters, so those are left out; the tip line names Shift+Enter instead.
- 2.x's table has row checkboxes, a "+" for new views, and sort / filter / view-type / more menus; seqno has the gutter but no row selection, and offers search and the journals toggle as actions.
- Linked references have no filter menu (2.x and classic both offer one) and no per-block reference counts.
- No exit animation for the palette (it unmounts on close).
- Images inside references need the app to pass `resolveAsset` to the outliner (see hand-offs).

## Scenes compared

`page` (new: Garden Plan with its linked references), `journals`, `all-pages`, `search`, `showcase-top` (page properties), `right-sidebar` (a page with references in a card), each in light and dark, against Logseq captures from this run. Also compared one by one in a scripted session: unlinked references opened, the empty and typed palette, keyboard movement, the all pages search box, header and action hovers, a page reference row hover, the title in edit mode, dialog position at 700 and 1100px tall windows. The comparison runs on a local merge of `ui/pages`, `ui/shell` and `ui/blocks` (not committed), because the page lives inside the shell and renders the outliner.

## Tokens added

In `pages.css`: `--bg-table-row-hover`, `--fg-table-page`, `--opacity-table-tag`, `--opacity-view-actions`, `--references-top`, `--references-gap`, `--fold-offset`, `--crumb-max-width`. It reads the shell's `--bg-ghost-hover` / `--fg-ghost-hover` with measured fallbacks.
In `search.css`: `--palette-width`, `--palette-top`, `--palette-results-height`, `--bg-palette-results`, `--border-palette-group`, `--border-palette-footer`, `--ring-palette-active`, `--fg-palette-crumb`, `--fg-icon-tile`, `--fg-placeholder`, `--bg-keys-separator`, `--opacity-palette-section`, `--opacity-palette-action`, `--palette-crumb-max-width`. All measured in both themes.

## Contract changes

- `@seqno/rpc`: `PageRpcs` (`WatchReferences`, `WatchNameReferences`, `WatchUnlinkedReferences`, `WatchPageStats`, `Ancestors`) with `PageClient`, served by the same worker (`CoreRpcs.merge(PageRpcs)`) and reached through `WorkerPages` in `apps/web/src/core.ts`, which shares the worker protocol with `WorkerCore`. It is a separate group so the fake cores that implement `CoreRpcs` keep compiling. `OpenGraph` takes `wait?` and can fail with `GraphLocked`.
- `@seqno/index`: `watchBacklinks`, `watchBacklinksToName`, `unlinkedReferences` / `watchUnlinkedReferences`, `pageStats` / `watchPageStats`, `PageStat`.
- Worker: `openSession` takes `changed(touched pages)`; `Sessions.following` keeps streams on the open session across reopens.
- `apps/web/src/atoms.ts`: `graphLocked`, and `openGraph` waits for the lock after `GraphLocked`. `apps/web/package.json` lists `@seqno/syntax` (used for property values).

## Hand-offs for integration

- **Shell:** the header search button links to `/search` and sets `searchOpen`; both open the palette, and closing goes back. Once merged, drop `to="/search"` so it only sets `searchOpen` (the shell's own note). The shell hides `.seqno-page-title` in sidebar cards; the title now carries the 48px gap below it, so hidden titles leave no gap.
- **Outliner:** references hide the zoomed outliner's own `nav[aria-label="Breadcrumbs"]` and draw 2.x's reference crumbs instead. `PageView` should pass `resolveAsset` once `ui/blocks` lands (the prop doesn't exist on main yet). Unlinked mention marks find each reference's first `treeitem`.
- **kbd chips:** the palette has its own small `Keys` component; the shell has another (`ui/shell/Keys.tsx`). Merge them when both are on main.
- **E2E:** `flows/import.e2e.ts` and `flows/screens.e2e.ts` now look for the palette's `listbox "Nodes"` instead of the old search page's list.

## Tests

- `packages/index/test/index.test.ts`: unlinked mentions, page stats, and the live streams waking only for their own facts (backlinks by name and alias, a name with no page, unlinked mentions, stats).
- `apps/web/src/worker/test/core.test.ts`: linked and unlinked references over the real graph, stats and ancestors, a page watch waking only for its own page (and for a block moved away), a second core waiting for the lock.
- `apps/web/test/pages.test.ts`: reference grouping and breadcrumbs, table sorting and filtering, property filtering, palette highlighting and groups.
- `tools/e2e/flows/pages.e2e.ts`: the palette opening a page and its references, unlinked references after an edit, renaming from the title, the all pages table, Shift+Enter into the sidebar, a second tab waiting for the graph, lazy journals.

```sh
systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0 pnpm check
pnpm --filter @seqno/web build && pnpm --filter @seqno/web preview --port 4185 --strictPort
cd tools/e2e && SEQNO_E2E_BASE_URL=http://localhost:4185/ pnpm exec playwright test
SEQNO_E2E_BASE_URL=http://localhost:4185/ pnpm design page journals all-pages search
```

Results on `ui/pages`: `pnpm check` passes (lint, format, typecheck, 358 tests in 30 files); e2e 19 passed, 1 skipped (the on-demand screenshot flow). The same e2e suite also passes on the local merge with `ui/shell` and `ui/blocks`.
