# seqno next to Logseq: where the UI stands

The four UI parts (shell, blocks, editor, pages) are merged on `main` and wired together, and two polish rounds (`docs/design/polish-1/RESULTS.md`, `docs/design/polish-2/RESULTS.md`) worked through the critic's findings. This page goes scene by scene through the design harness: what matches Logseq now, and what's left. Light and dark were both compared in every scene, at 1440×900.

```
 header ─ ≡ ⌕ ············································· ⌂ ⋯ ▣      shell
 ┌────────────┬──────────────────────────────────┬───────────────────┐
 │ left       │ page title, page properties      │ right sidebar     │  shell + pages
 │ sidebar    │ ├ blocks ─ bullets, refs, tasks  │ cards: pages and  │  blocks
 │            │ │  editing block (CodeMirror)    │ blocks, same      │  editor
 │            │ │  [[ (( # / popups              │ outliner inside   │  editor
 │            │ └ linked / unlinked references   │                   │  pages
 └────────────┴──────────────────────────────────┴───────────────────┘
   Mod+K palette over everything                                         pages
```

Each part's own measurements are in its RESULTS.md: `apps/web/src/ui/shell/RESULTS.md`, `features/outliner/RESULTS.md`, `features/editor/RESULTS.md`, `apps/web/src/ui/pages/RESULTS.md`. The measured reference values are in `SPEC.md`.

## Scenes

| Scene                    | Reference | Verdict                                                                       |
| ------------------------ | --------- | ----------------------------------------------------------------------------- |
| `journals`               | 2.x       | Matches pixel for pixel except the graph's nav entries seqno doesn't have     |
| `page`                   | 2.x       | Matches; seqno also draws page properties (2.x drops them when pasted)        |
| `showcase-top`           | classic   | Content matches classic, properties in the file's order                       |
| `showcase-lower`         | classic   | Code blocks, tasks and properties line up; rows are 2.x's 28px (classic 29px) |
| `showcase-queries`       | classic   | Query blocks match: header, chips, bracketed groups, page panels, breadcrumbs |
| `editing`                | 2.x       | Matches; entering edit mode moves no glyph                                    |
| `autocomplete`           | 2.x       | Popup matches; 2.x also lists blocks under `[[`                               |
| `slash`                  | 2.x       | Matches; markdown wording ("Page reference") where 2.x says "Node reference"  |
| `search`                 | 2.x       | Palette and footer match, tag pages first with #; no Filters group            |
| `right-sidebar`          | 2.x       | Card rows land on Logseq's x; top bar has Contents and Help, no Page graph    |
| `left-sidebar-collapsed` | 2.x       | Matches                                                                       |
| `all-pages`              | 2.x       | Table matches, tag-only pages included; fewer header actions                  |

### journals

Matches:

- Header (48px, 32px buttons, 20px icons, per-theme opacities), left sidebar (246px, graph row, Navigations, Favorites, Recent).
- Journal titles 36px / 500 at x = 381, days stacked at Logseq's heights (529px for today, 500px for the others) with the 1px separator.
- Rows 28px, 30px indent, 6.4px bullets, guides, faint `[[ ]]` page refs, highlight, toggles on hover.

Left:

- Logseq's nav also has Flashcards and Graph view; seqno has neither feature, so they're left out.
- 2.x shows pasted `TODO` / `DOING` as plain text (it keeps task state in properties). seqno draws classic's checkbox and marker, which is right for a markdown graph.
- Recent is empty in a fresh browser; Logseq's lists the pages the harness pasted into.

### page

Matches: title, the blocks 20px left of it, "Linked references" 92px below the last block with its count and fold caret, page groups, 2.x's breadcrumbs, the body's top line. Header, count, caret and first rows land on Logseq's coordinates in both themes.

Left:

- seqno draws page properties as the first block, like classic. 2.x drops them when the harness pastes the page, so the pair differs by that block.
- Linked references count 3 in seqno and 1 in 2.x: the harness only pastes two pages into 2.x.
- No filter menu or hover toolbar on linked references. Referenced blocks show classic's count badge.

### showcase-top and showcase-lower

Compared with classic for markdown content, with 2.x's spacing for what both share.

Matches: properties box in the file's order, h1 to h3 with their rules, bold, italic, highlight, strike, inline code, links, bare URLs, tags, numbered lists, guides, Solarized code blocks (gutter, line numbers, language label, colors, plain member dots), task checkbox and marker offsets within 0.5px, priorities, SCHEDULED / DEADLINE, logbook total, quotes, embeds, reference counts that open classic's refs panel. Images in `../assets/` load (480×240 sketch at classic's 8px offset) and show classic's hover fade, actions and resize corner.

Left:

- Rows are 2.x's 28px; classic's are 29px (a 1px block border), so long classic pages drift 1px per row. 2.x is the reference for shared layout, so this stays.
- The page title sits where 2.x puts it, not where classic does.

### showcase-queries

Compared with classic, which draws `{{query}}` the same way for markdown graphs.

Matches: the 18px Live query header (14px search icon, 12px text at 0.9), the count right-aligned with the 18px table icon, 30px clause chips (14px, 4px padding, 1px border, radius 4), `and` groups drawn as `( AND chip chip )` with the thin 36px brackets at 0.3, the `+` in classic's color, results 4px in, each page in an 8px-padded panel (`#f8f8f8` / `#023643`), the page title as a link, breadcrumbs with chevrons and siblings under one crumb, `No matched result` at 14px / 0.9.

Left:

- No query settings icon, so the table icon sits where classic's settings icon is; the `+` opens the query text rather than classic's clause builder.
- The two apps list different matches (classic's demo graph has its own tasks), so the panels differ in content, not in layout.

### editing

Matches: CodeMirror takes the block's Inter 16px / 24px box with no padding, so entering edit mode moves no glyph (measured 0px in the journals and in a sidebar card). Raw markdown in the text color, caret in `--fg`, selection colors from the theme. Heading blocks keep their size while edited, like classic.

Left: nothing visible in the scene.

### autocomplete

Matches: the `[[` popup's anchor (20px left of the trigger, 3px under the caret's line, clamped to the window at x = 928), 512px frame, 32px rows, icons, matched-letter marks, the "New page" row's position.

Left:

- 2.x also lists matching blocks under the pages in `[[`. seqno ranks page titles only, dropping scattered-letter matches when closer ones exist.
- Tag-only pages (`#greenhouse`) are suggested now, first when they start with the text, followed by New tag.
- An empty `[[` lists 2.x's ten relative dates.

### slash

Matches: 2.x's groups, 288px width, 480px max height, 32px rows, group headings, 18px icons at 0.7, the active row.

Left:

- 2.x's "Node reference / Node embed" are DB-graph commands; seqno lists classic's markdown commands (Page and Block reference and embed), so the first rows read differently.
- A few of Logseq's own icons are replaced by the nearest Tabler icons.
- No fade-out after picking a row.

### search

Matches: the Mod+K palette's size and position (896px, top 125px), input row, group headers and counts, rows with icon tiles and breadcrumbs, marks, footer with kbd chips, dark theme dimming, keys (arrows, Ctrl+N/P, Enter, Shift+Enter into the sidebar, Esc clears then closes, like 2.x).

Left:

- No Commands or Filters groups (seqno has neither feature). The tip names Shift+Enter instead of 2.x's Ctrl+Enter.
- seqno's full text search returns more blocks than 2.x's. Tag-only pages lead with 2.x's # tile, and there is no Create offer for them.
- The footer has Open, Open in sidebar and Copy ref (Mod+C), on 2.x's right edge; the last query comes back selected.
- No exit animation.

### right-sidebar

Matches: 40vw panel with its 300ms width transition, the Contents and Help tabs, card header (caret, icon, title, ⋯ and ×), card menu, resizer. Inside cards, rows start at x = 876 and bullets at x = 898, Logseq's exact numbers. Block cards keep 2.x's 8px top gap and show the block without a second breadcrumb (the card header already names the page).

Left:

- The top bar has Contents and Help (the keyboard shortcuts card); 2.x also has Page graph, so Help sits 100px further left.
- 2.x shows an "Open properties" row (a DB-graph feature); seqno shows the page's properties block instead.

### left-sidebar-collapsed

Matches: the main column centers at 960px (248 to 1208), header buttons in place, the sidebar slides out with Logseq's three transitions.

Left: nothing visible in the scene.

### all-pages

Matches: wide layout (278 to 1424), view header, table columns and widths, 34px header, 33px rows, colors and hovers, sorting, the "Type to search" box, the journals toggle.

Left:

- No row checkboxes, "+" for new views, or filter, view-type and more menus.
- 2.x tags journals `#Journal` (a DB class); seqno shows the file's own tags.

## What integration fixed

The merge itself was clean except `pnpm-lock.yaml`, regenerated from both sides. The seams between the parts:

| Seam                     | Before                                                                                                                                     | Now                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Editor ↔ outliner        | EditorSlot re-implemented move and collapse; Shift+↑/↓ past the text just left                                                             | Forwards the outliner's `SelectUp/Down`, `MoveUp/Down`, `Collapse`, `Expand` intents                           |
| `((` popup               | block rows showed only the page title                                                                                                      | page and parent breadcrumbs, from the pages lead's `Ancestors` RPC (shared with the palette)                   |
| Search button            | a link to `/search` that also opened the palette                                                                                           | opens the palette only; `/search` still opens it as a route                                                    |
| Sidebar cards            | rows 8px right of Logseq's (the main column's page padding), zoom breadcrumb                                                               | rows and bullets on Logseq's x, block cards with 2.x's 8px gap and no duplicate breadcrumb                     |
| kbd chips                | two components (shell and palette)                                                                                                         | one (`ui/shell/Keys.tsx`), the palette scopes its measured weight and separator                                |
| Images                   | `resolveAsset` was never passed, so images showed their alt text                                                                           | the graph's `assets/` folder (picked folder or OPFS) becomes object URLs, revoked when the graph changes       |
| Navigation while editing | Mod+O, Mod+Shift+O, Alt+→/← and Shift+Enter in popups had no callback                                                                      | the editor sends `Open`, `ZoomIn`, `ZoomOut`; EditorSlot navigates with the app's router; e2e flows cover them |
| Demo graph name          | "demo"                                                                                                                                     | "Demo", like Logseq (the OPFS folder keeps its name)                                                           |
| Old styles               | `styles.css` still styled the old search page, list and journals                                                                           | removed                                                                                                        |
| Harness                  | `showcase-lower` framed 16px off (`scrollBy` on the tree, which doesn't scroll), and sometimes shot before the rows below the jump mounted | scrolls the nearest scrolling ancestor and waits until no unmounted-row spacer is on screen                    |

Checked by hand in a headless session as well: moving a block while editing keeps the editor focused, Shift+↑ from the first line selects the block and the one above, Mod+↑/↓ collapse and expand, shell shortcuts (`t t`, `g j`) are ignored while typing, Mod+K opens the palette from the editor, the slash menu inside a sidebar card clamps to the window edge, and the palette sits above an open sidebar.

## Beyond the scenes (polish round 1)

Surfaces the scenes don't capture, each compared with the live apps:

- **Start and reload**: the last graph opens before the first render, with the shell drawn while it loads; reloads keep the route. All graphs is a page in the shell (`/graphs`, title at x = 371 like 2.x) with Last opened at dates, reached from the switcher's All graphs row. Tabs carry the page title and seqno's favicon.
- **Bullet menu**: 2.x's 280px menu at the pointer, swatch and heading rows on 2.x's coordinates, then the markdown-graph rows.
- **Hover previews**: 610px, centered under the ref (above when roomier), 1s in, 0.8s out, page title over its blocks.
- **Editing**: properties as `key:: value` lines in blocks and on pages, outlines pasted as blocks, code edited in place in its Solarized frame, popups that flip above near the bottom edge, no keys lost at machine speed.
- **Header menu**: Export page and Settings in 2.x's positions; Settings is a two-pane dialog (General, Keymap).
- **Index**: tag-only pages everywhere 2.x shows them, per-block reference counts like classic.

## Beyond the scenes (polish round 2)

Surfaces the scenes don't capture, each compared with the live apps:

- **Outlining**: nesting any block under any other survives a reload; Ctrl+Z / Ctrl+Shift+Z work with nothing focused, one step per command, editing the block they change; renaming a page rewrites every reference to it in one undo step.
- **Blocks**: the 28px add-block strip under the last block (0.5 on hover), Enter on a `key:: value` line adds a property line, plain text pastes as one block per paragraph and a URL over a selection becomes a link, `$$` pairs, ↑/↓ keep the character column.
- **Bullet menu**: centered under the pointer, 5px below, like 2.x.
- **Date picker**: `/Scheduled` and `/Deadline` open classic's calendar with Add time and Add repeater; an empty block gets classic's top-right toast instead.
- **References**: the count badge opens classic's refs panel under the block.
- **Images**: hover fade with Delete, Copy, Maximize, and a resize corner that writes `{:width N}`.
- **Shortcuts**: `g s` opens Settings › Keymap (search, folding groups, the editing keys); the help menu opens the same list as a Help card in the right sidebar. Settings sits on 2.x's coordinates with its type sizes.
- **Favorites** no longer write into the page file. A first visit opens with the left sidebar closed. The palette footer's chips land on 2.x's x.

## Gaps across scenes

Most visible first.

1. **Features seqno doesn't have:** Flashcards, Graph view, Page graph, Plugins, palette Commands and Filters, all-pages views and filters, linked reference filters and their hover toolbar, the multi-block selection toolbar, Export as OPML / HTML / EDN, the query builder's clause menu and settings, Settings' Editor / Advanced / Features tabs.
2. **`[[` lists pages only**; 2.x also lists matching blocks.
3. **Favorites** live in app storage, not `config.edn`.
4. **Small motion gaps:** no exit animation for the palette or the editor popups. After a long jump down a page (1,500px at once), the rows below appear one observer tick later (under 100ms); normal scrolling has them mounted 800px ahead.

## Tokens

No new theme tokens at integration. The palette now sets the shell's `--bg-kbd-separator` to its measured `rgb(255 255 255 / 0.14)` in dark, instead of keeping a second `--bg-keys-separator` token.

Polish round 1 added component tokens, listed in `docs/design/polish-1/RESULTS.md`: Logseq's highlight colors for block backgrounds (`--bg-highlight-*`, both themes), the block menu's swatches (`--swatch-*`) and the code editor's active line. Round 2's (query chips, refs panel, image fade, date picker, toast, keymap list) are listed in `docs/design/polish-2/RESULTS.md`.

## How to check it

```sh
# build and serve (port 4190 was polish round 2's)
pnpm --filter @seqno/web build && pnpm --filter @seqno/web preview --port 4190 --strictPort

cd tools/e2e
SEQNO_E2E_BASE_URL=http://localhost:4190/ pnpm exec playwright test         # e2e flows
SEQNO_E2E_BASE_URL=http://localhost:4190/ pnpm design                       # every scene, both apps, both themes
SEQNO_E2E_BASE_URL=http://localhost:4190/ SEQNO_SCREENS=1 \
  pnpm exec playwright test flows/screens.e2e.ts                            # refresh docs/screens
```

Wrap each in `systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0` on this machine. The pairs land in `tools/e2e/design-out/compare.html`; `docs/screens/` has the light and dark screens of the showcase graph (journals, page, showcase, editing, search, right sidebar, all pages).
