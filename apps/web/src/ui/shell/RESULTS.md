# App chrome (shell): results

Logseq 2.x's app chrome, rebuilt for seqno: header, left and right sidebars, menus, tooltips, dialogs, the help button, the open-graph screen and the UI shortcuts. Measured against test.logseq.com in light and dark at 1440×900, with `getComputedStyle` and side-by-side screenshots.

```
 ui/Shell.tsx            layout: header + left sidebar + main column + right sidebar + help
 ui/OpenGraphScreen.tsx  "All graphs" screen shown before a graph is open
 ui/shell/
   Header.tsx            ≡ ⌕ … ⌂ ⋯ ▣, the ⋯ menu, appearance panel, delete page confirm
   LeftSidebar.tsx       graph switcher, Navigations, Favorites, Recent, resizer
   RightSidebar.tsx      top bar, stacked item cards, Contents, resizer
   HelpButton.tsx        ? button, help popup, keyboard shortcuts dialog
   popover.tsx           menu, tooltip and dialog primitives (native popover and <dialog>)
   shortcuts.ts          Logseq's sequence shortcuts as a pure state machine
   listeners.ts          global keydown, recent-page tracking
   state.ts              persisted shell settings (wide mode, widths, collapsed groups, recent)
   shell.css             all chrome styles, on theme.css tokens
```

## What matches Logseq now

Checked pixel by pixel against Logseq 2.x in both themes, and by computed style where the numbers matter:

- **Header:** 48px, menu and search at (8, 8) and (40, 8); ⋯ and the right sidebar toggle against the main column's right edge (they move with the right sidebar); ⌂ appears off the journals page. 32px buttons, 20px Tabler icons, Logseq's per-theme opacity and hover. Tooltips with Logseq's labels and kbd chips, 4px below, 700ms delay, kept 4px inside the window.
- **⋯ menu:** 256px at (1173, 38), same items Logseq shows that seqno can back: Add to Favorites / Unfavorite, Delete page (pages only, with Logseq's confirm dialog), Appearance. Separator, item padding, hover and keyboard focus colors, fade + zoom + slide in, fade + zoom out.
- **Appearance panel:** 511px, anchored under ⋯ like Logseq's; theme tiles (light, dark, system) with the 2px choice ring, the "Switch to dark/light theme" label, wide mode switch, kbd hints.
- **Left sidebar:** 246px, graph switcher row, Navigations (Journals with the `g j` hint after 2s, Pages), Favorites and Recent as collapsible groups that remember their state, page rows with the hover ⋯ menu ("Open in sidebar ⇧ Click", plus Unfavorite for favorites). Collapse slides the panel and shrinks the column in 150ms while the main column's padding eases over 300ms, exactly Logseq's three transitions. Resizable (240 to 460px), remembered.
- **Graph switcher menu:** 300px at 4px below the row, Logseq's ghost action rows (Open a folder, Demo graph) and the "Switch to:" list of recent graphs.
- **Right sidebar:** 40vw, width animates over 300ms, top bar with the Contents tab, cards with the 32px header (caret, icon, title, ⋯ and × actions), Logseq's card menu (Close, Close others, Close all, Collapse/Expand, Collapse others, Collapse all, Expand all, Open as page), the Contents card when empty, a resizer that tints after 300ms and closes the sidebar when dragged to the edge.
- **Main column:** padding 32 16 32 32, 960px centered between the sidebars (371 to 1331 with the left sidebar open, 248 to 1208 closed), 1146px in wide mode, matching Logseq at every sidebar combination checked.
- **Help:** the 32px ? circle at (1376, 852) with "View shortcuts and tips", Logseq's help popup (260px, its colors and rows), and a keyboard shortcuts dialog.
- **Dialogs:** native `<dialog>` with Logseq's blurred 80% overlay, 8px radius, 200ms fade and zoom.
- **Open-graph screen:** Logseq's "All graphs" layout: 36px title at y = 80, primary and secondary buttons at y = 166, "Local graphs:" list.
- **Shortcuts** (from Logseq's keymap): `t t`, `t l`, `t r`, `t w`, `g j`, `g h`, `g a`, `g s`, `c t`, `?`, `Alt+Shift+C` (Contents), `Alt+Shift+J` (today in the sidebar). Ignored while typing in the editor, inputs, menus and dialogs.
- **Focus:** ring from theme.css on buttons; the header's two left buttons keep Chrome's outline like Logseq's; menus return focus to their trigger.

Scenes compared (`tools/e2e/design`, light and dark): `journals`, `right-sidebar`, `left-sidebar-collapsed`, `all-pages`, `showcase-top`, `showcase-lower`, `editing`, `autocomplete`. Interactions compared one by one in a scripted headless session: ⋯ menu, appearance panel, tooltips, graph switcher, help popup, recent row menu, card menu, delete confirm, hover states of every sidebar row, sidebar toggle transitions (`document.getAnimations()` on both apps), wide mode widths, a 700px window.

## What doesn't match yet

- Logseq's nav has Flashcards and Graph view, its right sidebar top bar has Page graph and Help, and its ⋯ menu has Settings, Plugins, Recycle, Export and Import. seqno has none of those features, so they are left out on purpose.
- The graph switcher has no "All graphs" entry (there is no graphs route to send it to) and no per-graph menu on the open-graph screen.
- The appearance panel has no Font, Show brackets or Accent color rows.
- The demo graph is named "demo" by `graph-locations.ts`; Logseq shows "Demo".
- Recent is empty in a fresh browser (Logseq's harness pages were visited while pasting), so the `journals` pairs differ there.
- Page titles, blocks, the "Star" button and the all pages list inside the main column belong to the pages and blocks leads.

## Hand-offs for integration

- **Search:** the header's search control is a link to `/search` that also sets `searchOpen`. It keeps today's search page reachable (and the e2e search flow green) until the pages lead's palette lands. Once the palette exists, drop `to="/search"` from `SearchButton` in `Header.tsx` so the button only opens the palette.
- **Sidebar cards** hide the page's own title with `.sidebar-item-content :is(.page-header, article > header:first-child, .seqno-page-title)` (today's markup and the pages lead's), because the card header already shows it. If PageView's title markup changes, update that selector (or give PageView a "no title" option).
- The empty Contents card creates a `Contents` page on click, like classic Logseq's `contents.md`.

## Tokens added in shell.css

`--bg-kbd-separator`, `--bg-resizer`, `--bg-button-primary`, `--bg-button-primary-hover`, `--fg-button-primary`, `--shadow-button-primary`, `--shadow-button-primary-hover`, `--bg-ghost-hover`, `--fg-ghost-hover`, `--bg-menu-action-hover`, `--fg-menu-action-hover`, `--bg-switch-off`, `--bg-switch-on`, `--ring-choice`, `--bg-dialog-overlay`, `--shadow-sm`, `--text-heading`, `--leading-heading`, `--text-detail`, `--leading-detail`, `--left-sidebar-top`, `--left-sidebar-inset`, `--help-inset-right`, `--help-inset-bottom`. Every value is measured from Logseq 2.x in both themes.

Measured values the spec didn't have yet:

| Surface             | Value                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph switcher menu | 300px, 4px below the row, padding 4 8; actions 32px, padding 0 12, gap 6, 14px/500 at opacity 0.7, hover 0.9 on `#f3f3f3 / #004152` with text `#0f172a / #d1d1d1`                           |
| Help popup          | 260px, 8px above the ? button, right edges aligned, `--bg-sidebar-tab`, 1px `--border`, radius 8, small shadow; rows 32px, padding 4 16, 16px `--fg-control`, 20px icons at 0.4             |
| Help button         | 32px circle `--bg-sidebar`, `IconHelpSmall` scaled 1.25, opacity 0.7, 1 on hover, tooltip "View shortcuts and tips"                                                                         |
| Recent row menu     | 240px centered under the row's ⋯, one item, icon scaled 0.9 at 0.8, kbd hint "⇧ Click"                                                                                                      |
| Card action hover   | `rgb(244 244 245 / 0.7) / #004152`, icon `#0f172a / #fafafa`                                                                                                                                |
| Confirm dialog      | 512px, padding 24, gap 16, title 18px/500 with a warning icon, detail at 0.6 in `--fg-control`, Cancel (outline) and Confirm (primary) 28px buttons; overlay 80% background with a 4px blur |
| Theme tile          | 70×40, radius 4, active ring 2px inset `#106ba3 / #8abbbb`, others at 0.9, 1 on hover; label 12px/500                                                                                       |

## Tests

- `apps/web/test/shell.test.ts`: the shortcut sequences, Alt chords by physical key, Ctrl/Cmd pass-through, the recent list and the sidebar width bounds (11 tests).
- `pnpm check`: lint, format, typecheck and 345 tests pass.
- E2E against this build on port 4182: 12 passed, 1 skipped (the on-demand screenshot flow).

```sh
pnpm --filter @seqno/web build && pnpm --filter @seqno/web preview --port 4182 --strictPort
cd tools/e2e && SEQNO_E2E_BASE_URL=http://localhost:4182/ pnpm exec playwright test
SEQNO_E2E_BASE_URL=http://localhost:4182/ pnpm design --app seqno journals right-sidebar left-sidebar-collapsed
```
