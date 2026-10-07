# Polish, round 2: results

This round worked through the critic's second list against Logseq 2.x (test.logseq.com) and classic (demo.logseq.com), majors first, then minors, then nits. Every finding has a fix on `main`. Each fix was measured in headless Chrome next to the reference app (computed styles and screenshots), and the design harness was captured again at the end. Where the UI stands scene by scene is in `docs/design/UI.md`.

The round was cut off once (18:52). Its first six majors were already committed; the query block was finished from the uncommitted draft.

## What was wrong, and what it does now

### Majors

| Finding                                                   | Now                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nesting an older block under a newer one locked the graph | On reopen, `@seqno/graph` sends a parent's `BlockUpserted` before the blocks moved under it. A graph that still fails to open shows the error inside the app frame with Retry. Graph test and an e2e reload flow cover it.                                                                                                                               |
| Ctrl+Z / Ctrl+Shift+Z with nothing focused                | The shell handles Mod+Z, Mod+Shift+Z and Mod+Y when the target isn't editable. After each step the editor opens on the block the step changed, with the caret where the change was, or on the row above when only blocks were removed.                                                                                                                   |
| One Ctrl+Z took back too much                             | Typing in one block is one Loro undo group; every structural command (CreatePage, InsertBlock(s), SplitBlock, MergeWithPrevious, Indent, Outdent, MoveBlocks, DeleteBlocks) is its own step. `abc`, Enter, `def` takes four Ctrl+Z, as in Logseq.                                                                                                        |
| Renaming a page left its references behind                | The worker finds the blocks and pages that reference the old name in the index and rewrites `[[links]]`, `#tags`, `#[[tags]]` and `tags::` / `alias::` items with `@seqno/syntax`'s `renameRefs`, in the same commit as the title, so one undo reverts all of it.                                                                                        |
| Property order followed the Loro map                      | Each page and block keeps its keys in a mergeable Loro list next to the props map. Import seeds it in file order and new keys go last, so the box, the editor and Export read like the file.                                                                                                                                                             |
| `{{query}}` showed as raw text                            | Classic's query block: the Live query header (count only when there are results, a table toggle), the clauses as chips with `and` / `or` / `not` drawn as thin bracketed groups, results grouped by page in the embed panel with siblings under one breadcrumb, `No matched result` when empty. Live through `WatchQuery`. The `+` opens the query text. |

### Minors

| Finding                       | Now                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bullet menu at the pointer    | Centered on the pointer and 5px below (139px left of it, like 2.x), flipping above with the same gap, growing from its top center.                                                                                                                                                                                                              |
| Enter on a `key:: value` line | Adds a line in the same block for the next property, like classic.                                                                                                                                                                                                                                                                              |
| Click below the last block    | A 28px strip under the last block of pages, journals, zoomed blocks and sidebar cards shows a 0.5-opacity bullet on hover; clicking adds an empty block and edits it. Embeds and reference groups leave it out, like 2.x.                                                                                                                       |
| Pasting plain text and links  | Text without list markers becomes one block per paragraph (fences stay whole); a URL pasted over a selection becomes `[selection](url)`.                                                                                                                                                                                                        |
| Undoing a page's creation     | The missing-page view (title and placeholder bullet), and Recent drops the page; redo brings both back.                                                                                                                                                                                                                                         |
| Move block on a Mac           | Mod+Shift+↑/↓ while editing and with blocks selected (Alt+Shift elsewhere).                                                                                                                                                                                                                                                                     |
| Spellcheck                    | On, with autocorrect and sentence capitalization, like Logseq's textarea.                                                                                                                                                                                                                                                                       |
| /Scheduled and /Deadline      | Classic's 511px date picker under the block: a Sunday-first month grid with the block's date or today chosen, Add time, Add repeater (`.+N` h/d/w/m/y), Submit. On an empty block, a "Please add some content first." toast instead.                                                                                                            |
| Reference count did nothing   | The count is a button that opens the referencing blocks under the block, before its children, grouped by page with breadcrumbs in classic's refs panel; it starts open when zoomed into the block. Backed by a new `WatchBlockReferences` RPC.                                                                                                  |
| Favorites wrote the page file | Favorites are a per-graph list in app storage, in the order added (like `:favorites`). Nothing is written into the page; the demo graph no longer carries `favorite:: true`.                                                                                                                                                                    |
| Keyboard shortcuts            | One searchable list (Search shortcuts…, folding groups) built from the editor's own binding table, the selection keys and the shell shortcuts: Basics, Navigation, Editing, Selected blocks, Sidebars, Appearance. `g s` opens Settings › Keymap, like 2.x; the help menu opens it as a Help card in the right sidebar, which gains a Help tab. |
| Hovering an image             | A white-to-clear fade over the image with Delete, Copy and Maximize (26×32 buttons, 18px icons), and classic's resize corner. Resizing writes `{:width N}`, which the parser now reads; Copy puts a PNG on the clipboard; Maximize opens a dialog.                                                                                              |
| Settings dialog               | 962×632 at (239, 125), 600-weight title at y = 146, 14px nav and labels, 2.x's spacing, a Current version row (the build's git revision), focus on the dialog itself so no ring shows.                                                                                                                                                          |
| Harness all-pages scene       | Waits for the table's first data row.                                                                                                                                                                                                                                                                                                           |

### Nits

| Finding                     | Now                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Member dot in TS/JS code    | Plain code color (an empty highlight class used to fall through to the operator tag).                                                     |
| ↑/↓ between blocks          | Keep the caret's character column in its line, not its pixel x.                                                                           |
| `$$` autopair               | The second `$` closes the pair with the caret inside.                                                                                     |
| Ctrl+V right after Enter    | The paste is held with the other keys and lands in the new block.                                                                         |
| Page ref hover              | Keeps its color, like 2.x.                                                                                                                |
| Help menu                   | Keyboard shortcuts, Logseq documentation, and a muted `seqno / Revision <hash>` footer.                                                   |
| Left sidebar on first visit | Closed.                                                                                                                                   |
| Palette footer chips        | ⇧⏎ is one glued combo and the chips use 2.x's regular weight: Open, Open in sidebar and Copy ref land on 2.x's x to the tenth of a pixel. |

## What doesn't match yet

- **Query builder**: the `+` opens the query text for editing instead of classic's clause builder menu, and there is no query settings (columns) button, so the table icon sits 22px right of classic's.
- **Help card**: no markdown cheat-sheet table above the shortcut list, and no Search by keys or Custom / Unset / Disabled filters (seqno has no custom bindings).
- **Help menu**: seqno has no documentation site or release notes yet, so there are no seqno Documentation or Release notes rows. The docs row points at Logseq's, since seqno reads Logseq's markdown.
- **Settings**: General and Keymap only; no Editor, Advanced or Features tabs, and no Language, Font or Accent color rows (seqno has one font and no accent setting).
- **Favorites** live in app storage, not in `config.edn`'s `:favorites`, so a folder opened in Logseq doesn't see them and a Logseq graph's favorites aren't imported.
- **Date picker** keeps the block in edit mode after Submit; classic leaves edit mode. No keyboard navigation inside the grid.
- **Image resize** writes width only (`{:width N}`); classic writes height too.

## New tokens

Component tokens, in the component CSS:

- `features/outliner/src/outliner.css`: `--border-query-clause`, `--fg-query-add` (query chips and `+`), `--bg-block-refs` (refs panel), `--bg-image-fade` (image hover fade).
- `features/editor/src/theme.ts`: `--fg-date-month`, `--fg-date-weekday`, `--fg-date-off`, `--bg-date-hover`, `--bg-date-active`, `--bg-date-select`, `--border-date-input` (date picker, measured in both themes).
- `apps/web/src/ui/shell/shell.css`: `--bg-notice`, `--fg-notice`, `--fg-warning` (toast), `--border-shortcut-search`, `--bg-shortcut-group` (keymap list).

## Contract changes

- `@seqno/rpc`: `WatchBlockReferences { uuid }` in `CoreRpcs`, streaming the blocks whose text holds `((uuid))`.
- `@seqno/index`: `watchBlockReferences`.
- `@seqno/syntax`: `Image` inlines carry `width` and `size` (classic's `{:width N}` suffix); `pastedBlocks` splits plain text at blank lines; `renameRefs`.
- `@seqno/editor`: `editorBindings` (labels and keys, with Mac variants), `EditorAction.Notify`, `CursorPlacement.FirstLine` / `LastLine` carry a `column` instead of a pixel `x`.

## Scenes compared

All 12 harness scenes, light and dark: `journals`, `page`, `showcase-top`, `showcase-lower`, `showcase-queries` (new, against classic), `editing`, `autocomplete`, `slash`, `search`, `right-sidebar`, `left-sidebar-collapsed`, `all-pages`. Plus one-off probes against the live apps for the query block (and/or/property/full-text/empty queries), the bullet menu position, the add-block strip, the date picker and its toast, the block refs panel, Settings General and Keymap, the right sidebar Help card, image hover, and the palette footer.

## How to check it

```sh
pnpm --filter @seqno/web build && pnpm --filter @seqno/web preview --port 4190 --strictPort
cd tools/e2e
SEQNO_E2E_BASE_URL=http://localhost:4190/ pnpm exec playwright test   # all flows
SEQNO_E2E_BASE_URL=http://localhost:4190/ pnpm design                 # every scene, both apps
```

Wrap each in `systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0`. Inside that cap, one `vitest run` over every project gets OOM-killed (the main process keeps every project's modules), so the test step was run in smaller groups of projects; each group passes.

New flows: `flows/query.e2e.ts`, and in `blocks.e2e.ts` the add-block strip, block references, image hover; in `editor.e2e.ts` the date picker and toast, paste right after Enter, character-column arrows; in `pages.e2e.ts` favorites and the keymap.

| Suite                    | Result                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm check`             | lint, format and typecheck clean; vitest 489 passed in 44 files (run in project groups) |
| Playwright (`tools/e2e`) | 56 passed, 2 skipped (the on-demand screenshot flows), against 4190                     |
| Design harness           | all 12 scenes, both apps, light and dark; no missing steps reported                     |
