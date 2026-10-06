# @seqno/outliner results

The block tree: rendering, bullets, selection, keyboard, drag, zoom and virtualization. It renders blocks to `docs/design/SPEC.md` (Block row, Block text, Inline elements, Block selection), on the same parser the core uses (`@seqno/syntax`).

```
<Outliner pageId zoom onNavigate editor? embedded? resolveAsset?>
  reads   pageTreeAtom(pageId)   WatchPage stream
  writes  dispatchAtom(command)  Dispatch rpc

  nav "Breadcrumbs"            (zoomed only: page / ancestors, like 2.x)
  tree "Outline"               (focusable: block selection keys live here)
    gap                        (spacer for rows above the window, watched)
    treeitem  padding-left = depth × --block-indent
      guide × depth            (1px line + 4px hover strip per ancestor)
      selection                (subtree box when selected)
      control  [toggle 22][bullet 16]  gap 4
      content  BlockView | <Editor/>
    gap                        (spacer for rows below the window, watched)
```

## What matches Logseq now

Compared in `tools/e2e/design-out/compare.html` (scenes below) and with measurements (`getComputedStyle`, `getBoundingClientRect`) of both apps.

**Rows and bullets** [2x]

- 28px one-line rows (2px padding, 24px line), children indented 30px, content at x0 + 42 (22px toggle column, 16px bullet box, 4px gap). Every level and every block type stacks the way Logseq's does: h1 65px, h2 50px, h3 32.8px, properties block 136px, quote 56px, embed 44px.
- Bullet: 6.4px dot, `--bullet` at 0.8, in a 16px box; hover fills the box with `--bg-bullet-halo` and scales the dot to 1.2 over 200ms. Collapsed blocks keep the halo.
- Toggle arrow: Tabler's filled caret (the icon 2.x uses), 22×22 control at +1.5px, 16px icon at +4/+2, `--fg-control` at 0.4, rotated 90° when expanded over 100ms ease-in. Shown only while the block's own row is hovered, never while hovering a guide.
- Bullets and toggles line up with the first line of headings (16px / 9px / 2.4px down for h1 / h2 / h3), as in classic.
- Children guide: 1px `--guide` line under the parent's bullet centre, from the parent's last line to the last descendant. Hovering it shows 2.x's 4px rounded strip (`#858585` / `#a4b5b6` at 0.7, 1 while pressed) along the whole run; clicking it collapses the parent.
- Numbered lists (`logseq.order-list-type:: number`, in the text or in `block.props`): "1." "2." … in a 22px box, 15px, `--fg-control` at 0.8, centred where the dot would be.
- Selection: `--bg-block-selected`, radius 4px, one box from the selected block's toggle column to the right edge covering its whole subtree (2.x selects children with the parent), fading in with `--ease-select`.
- Zoom: the bullet zooms (shift-click opens the block in the right sidebar). The breadcrumb is 2.x's: page title, then ancestors (not the zoomed block), `/` at 0.5 with 4px padding, links in `--fg-control`, 28ch each, 2px left of the bullets, blocks 56px below.

**Block content** [classic for markdown-only content, 2x for the rest]

- Text: Inter 16px / 24px, `pre-wrap`, same box as the editor (no padding, x0 + 42, 2px below the row top).
- Tasks: checkbox (16px square, `--bg-checkbox`, white check when DONE, 5px gap, 5.6px down), marker 13.6px / 650 at 0.7 with 2px 4px padding. TODO/DOING/LATER/NOW in `--fg-link` and clickable (TODO↔DOING, LATER↔NOW); WAIT/WAITING/IN-PROGRESS in `--fg`, not clickable; DONE checked with no word, text struck at 0.7; CANCELED/CANCELLED no checkbox, struck at 0.7. Positions match classic within 0.5px (checkbox 0/5.6, marker 21/3, priority 70.3, text 106.7).
- Priority `[#A]` 16px `--fg-link` at 0.5, 3.5px gap, no space after it (classic drops it), links to the A page.
- SCHEDULED / DEADLINE: a 20px row, 14px, label 500 at 0.5, date `<2026-10-08 Thu .+1w>` in `--fg-link` at 0.8.
- Properties: one box (`--bg-properties`, 4px 8px padding, 4px margin, radius 4px), key 500 `--fg-property-key` linking to its page, `:` with 4px after it, values with refs; `tags`/`alias` values become bare page links. `id`, `collapsed`, `heading`, `logseq.*`, timestamps and `hl-*` stay hidden. Reads both property lines in the text and `block.props` (where the importer puts them).
- `:LOGBOOK:` hidden; the clocked total ("1h34m") sits at the right of the title row (14px, `--fg-control` at 0.8, 3px down); clicking it opens the drawer.
- Page refs: name in `--fg-link` (hover `--fg-link-hover`), `[[` `]]` in `--fg-bracket` at 0.3 drawn as pseudo-elements, so link names and row text stay clean. Namespaced names show in full.
- Tags 14.4px `--fg-link` at 0.8 (1 on hover), 2px padding, radius 4px. `#[[multi word]]` shows `#multi word`.
- Block refs: the referenced block's title, live (same page from the tree, other pages through `WatchPage`), 1px `--border-block-ref` underline, `cursor: alias`. Embeds: `--bg-embed` box, 4px 12px 8px padding, a nested editable outline of the block and its children (page embeds add the page title).
- Bold 700, italic face, `~~strike~~`, `==mark==` and `^^mark^^` (`--bg-mark` / `--fg-mark`, 0 4px, radius 4px), inline code (mono 14.4px / 20.88px, 3px 5px, radius 4px), links (`--fg-link` with a 1px underline border), bare URLs, images (radius 4px, up to the content width).
- Code blocks, Solarized as classic draws them: 31px gutter (`--bg-code-gutter`, numbers right-aligned with 5px padding), mono 14px / 23.2px, 18px above and 16px below the lines, 4px line padding, language label top right (14px, 4px 6px, `--bg-code-lang` at 0.8). Highlighting reuses Lezer (the parsers CodeMirror ships) for js/jsx/ts/tsx/css/html/python, mapped to classic's colours: keywords orange, definitions and properties teal, types and operators violet, strings green, numbers magenta, locals olive (a small scope pass, as classic's JS mode does), selectors olive.
- Quotes (`> x` and `#+BEGIN_QUOTE`): `--bg-quote`, 4px `--border` left edge, 8px 20px padding, 8px margin, `--fg-quote`. Headings: h1 32/48, h2 24/36 with the bottom border, h3 19.2/28.8, all 600, spanning the content width.

**Behaviour**

- Clicking text puts the caret where you clicked (source offsets carried on the rendered text); clicking past the end of a line puts it at the end. Text selections inside a block are left alone.
- Block selection: Esc from the editor selects the block, Esc again clears; Shift+click and Shift+↑/↓ extend (Shift+↓ skips a selected parent's children); dragging the mouse from one block into another selects the blocks between; clicking outside clears. In selection mode: ↑/↓ (or Alt+↑/↓) move, Enter edits, Shift+Enter opens in the sidebar, Tab/Shift+Tab indent, Backspace/Delete delete, Mod+↑/↓ collapse/expand, Alt+Shift+↑/↓ move blocks, Mod+Enter cycles TODO → DOING → DONE → none, Mod+Shift+A selects all, Mod+A selects the parent, Mod+C/Mod+X copy (and cut) the blocks as markdown, **Mod+Z / Mod+Shift+Z / Mod+Y dispatch Undo / Redo**.
- Clicking a task checkbox dispatches one `EditText` replacing the marker (`setMarker` in `@seqno/syntax`).
- Shift-click on a page ref, tag, block ref, breadcrumb or bullet asks for the right sidebar (`SidebarPage` / `SidebarBlock`).
- Drag and drop as before (bullet drags, before/after/child zones), with a 2px `--fg-link` drop line.

**Virtualization in the real app.** Rows are in normal flow between two spacer divs, so the page (or any scrolling ancestor) scrolls them; nothing needs a bounded height. An `IntersectionObserver` (with `rootMargin` and `scrollMargin` of 400px) watches the spacers; whenever one comes near the viewport, by scrolling, a jump, a resize or a layout shift above, the outline re-reads its position and mounts the rows within 800px of the viewport. Measured heights (a shared `ResizeObserver`) size the spacers, estimates fill in for rows never shown. The editing row and dragged rows stay mounted. Checked in the built app on a 3,000-block page: 58 rows mounted, scrolling to the end swaps in the last rows and drops the first, with the document scrolling and with an inner scroll container (the shell's layout).

## What doesn't match yet

- **Property order** comes from the core: `block.props` is a Loro map, so properties show in its key order, not the file's (Tomato bed shows sown, location, plants, variety; Logseq shows variety, location, sown, plants). Fixing it needs the graph to keep an order.
- **Reference counts**: classic shows a small count at the right of a referenced block ("2"). The RPC has no per-block reference count, so it isn't drawn.
- **Images** need the app to resolve `../assets/…` paths: `Outliner` takes `resolveAsset(path) => url | undefined`; until the app passes one, relative images show their alt text with an image icon. Absolute and data URLs load.
- **Editing**: the editor (`@seqno/editor`, CodeMirror) still renders in a monospace font with a border in this branch, so text moves on edit. The outliner gives it the exact box (x0 + 42, 2px down, 16px / 24px, no padding); the editor lead's CodeMirror styles must match it.
- Not measured, built to look consistent: the expanded logbook drawer, the page-embed title, the drop line colour, marker hover.
- Logseq's page preview popup on hovering a ref, the bullet context menu and `t n` / `t o` aren't built.
- The showcase-lower scene's scroll helper (`tools/e2e/design/seqno.ts` `scrollToText`) calls `scrollBy` on the `[role=tree]` element, which no longer scrolls; the target lands 16px higher than in the Logseq shot. Using the nearest scrolling ancestor fixes it (harness code, not changed here).

## Scenes compared

`showcase-top`, `showcase-lower`, `journals`, `editing`, `right-sidebar` in light and dark against the foundation's Logseq captures, plus hover, guide, selection, zoom and task-row probes against fresh 2.x and classic measurements (toggle, bullet halo, guide strip, subtree selection, breadcrumb, checkbox/marker/priority offsets, code block padding, properties box, quote, embed, row heights).

## Tokens added

Declared on `.seqno-outliner` (in `src/outliner.css`), all measured:

| Token            | Value                          | Used for                                 |
| ---------------- | ------------------------------ | ---------------------------------------- |
| `--guide-hover`  | `light-dark(#858585, #a4b5b6)` | guide hover strip [2x]                   |
| `--code-local`   | `#b58900`                      | local variables, CSS selectors [classic] |
| `--code-comment` | `#586e75`                      | code comments [classic]                  |
| `--code-tag`     | `#93a1a1`                      | HTML tag names [classic]                 |

## Contract changes for integration

- `EditorIntent` gained `SelectUp`, `SelectDown` (Shift+↑/↓ at the first/last line: select this and the neighbouring block), `MoveUp`, `MoveDown` (Alt+Shift+↑/↓), `Collapse`, `Expand` (Mod+↑/↓). The editor's `OutlineAction` (MoveUp, MoveDown, Collapse, Expand) maps one to one; `PlainTextEditor` emits all of them.
- `OutlinerProps` gained `embedded?` (no breadcrumb, root keeps its collapsed state; used for `{{embed}}`) and `resolveAsset?`.
- `@seqno/syntax` exports `parseInline`, `plainText`, `blockContent`, `propertyValue`, `isHiddenProperty`, `setMarker`, `clockTotal`. `features/outliner/src/markdown.ts` is gone.
- CSS classes are all `seqno-*` and avoid the pages lead's names (`seqno-properties`, `seqno-property*`, `seqno-ref*`): the properties box is `seqno-attrs`, page refs `seqno-pageref`.
- The breadcrumb is `nav[aria-label="Breadcrumbs"]` inside the outliner, positioned for the pages lead's `-20px` blocks container; the right sidebar and references can hide it.

## How to run its tests

```sh
# from the repo root, so the run shares pnpm test's Vite cache
systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0 \
  pnpm exec vitest run --project @seqno/outliner
```

25 Vitest browser-mode tests (headless Chrome, React Compiler on) against an in-memory core: rows and depth, refs and tags, hover toggle, guide click, 2.x breadcrumbs, caret placement, Enter / Tab / Backspace / arrows, Esc and Shift selection, mouse-drag selection, Undo/Redo in selection mode, subtree highlight, drag and drop, block refs, sidebar shift-clicks, task checkbox and marker, Mod+Enter, properties, SCHEDULED and the logbook, numbered lists, code highlighting, and virtualization with the document scrolling (3,000 rows). `test/theme.ts` gives them the size tokens the app's `theme.css` provides.

Memory, on this box's 1.5 GB scope: a warm run peaks around 1.25 GB, the full `pnpm check` around 1.4 GB, and both pass. A cold Vite dependency cache does not fit: Vite re-bundles every dependency (effect, React, Lezer, Tabler) while Chrome is already up and the scope is OOM-killed. A standalone `vitest run` inside `features/outliner` and the root run compute different cache hashes for the same `node_modules/.vite` folder, so alternating between them makes every run cold. Run the outliner from the root as above. If a run is killed right after a dependency or config change, run it again: the killed run usually commits the new cache.

`@seqno/syntax` tests cover the inline parser (spans, nesting, a 1,000-run property test against `analyzeBlock`'s refs), `blockContent`, `propertyValue`, `setMarker` and `clockTotal`.
