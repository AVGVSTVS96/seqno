# seqno design spec

What Logseq looks like, measured, so seqno can match it. Every value here came from `getComputedStyle` and `getBoundingClientRect` on the live reference apps (headless Chrome 153, 1440×900, Linux, October 2026), not from reading their CSS.

Sources, marked on each value:

- **[2x]** Logseq 2.x web, `https://test.logseq.com`. The reference for everything both versions share: app chrome, fonts, colors, block text, bullets, popups, light and dark.
- **[classic]** Logseq classic, `https://demo.logseq.com`. The reference only for markdown-file content that 2.x draws differently: task markers in the text, `[[page]]` brackets, `key:: value` properties, `:LOGBOOK:`, SCHEDULED/DEADLINE, priorities, code blocks, quotes, headings.

Colors are written `light / dark`. The token after each value is its custom property in `apps/web/src/theme.css`; use the token, not the literal. Coordinates are at 1440×900 with the left sidebar open and the right sidebar closed, unless a line says otherwise.

```
 0                246                                                  1440
 ┌─ header 48px (transparent, over everything) ──────────────────────────┐
 │ ≡ ⌕            │                                          ⋯  ▣       │
 ├────────────────┼───────────────────────────────────────────────────────┤
 │ left sidebar   │  main: padding 32 16 32 32                            │
 │ 246px          │        ┌──── content column, max 960px, centered ───┐ │
 │ --bg-sidebar   │        │ Oct 6th, 2026            36px / 500       │ │
 │                │        │                                           │ │
 │                │        │ ▸• block text            16px / 24px      │ │
 └────────────────┴────────┴───────────────────────────────────────────┴─┘
```

## Contents

1. [Background layers](#background-layers)
2. [Typography](#typography)
3. [Header bar](#header-bar)
4. [Left sidebar](#left-sidebar)
5. [Right sidebar](#right-sidebar)
6. [Main column](#main-column)
7. [Page title and journal title](#page-title-and-journal-title)
8. [Journals list](#journals-list)
9. [Block row](#block-row)
10. [Block text](#block-text)
11. [Inline elements](#inline-elements)
12. [Editing block](#editing-block)
13. [Block selection](#block-selection)
14. [Autocomplete popup](#autocomplete-popup)
15. [Slash menu](#slash-menu)
16. [Search palette](#search-palette)
17. [Buttons, menus, dropdowns, tooltips](#buttons-menus-dropdowns-tooltips)
18. [All pages](#all-pages)
19. [Scrollbars](#scrollbars)
20. [Focus rings](#focus-rings)
21. [Motion](#motion)
22. [Keyboard shortcuts](#keyboard-shortcuts)
23. [Not measured yet](#not-measured-yet)

## Background layers

[2x] unless marked.

| Layer                                  | Light                                             | Dark             | Token                      |
| -------------------------------------- | ------------------------------------------------- | ---------------- | -------------------------- |
| App background (body, main column)     | `#fcfcfc`                                         | `#002b36`        | `--bg-app`                 |
| Left and right sidebar                 | `#f8f8f8`                                         | `#023643`        | `--bg-sidebar`             |
| Right sidebar item header              | `#f3f3f3`                                         | `#08404f`        | `--bg-sidebar-item-header` |
| Popovers, menus, tooltips, dialogs     | `#ffffff`                                         | `#002d38`        | `--bg-popover`             |
| Overlay behind the search palette      | `#ffffff` at 90%                                  | `#002d38` at 90% | `--bg-overlay`             |
| Nav item and recent item hover, active | `#ededed`                                         | `#094b5a`        | `--bg-hover`               |
| Header icon button hover               | `#f3f3f3`                                         | `#08404f`        | `--bg-button-hover`        |
| Dropdown menu item hover               | `#ededed`                                         | `#00404d`        | `--bg-menu-active`         |
| Slash and autocomplete chosen row      | `#ededed`                                         | `#023643`        | `--bg-popup-active`        |
| Search palette active row              | `#f3f3f3` under a 7% black inset, about `#e2e2e2` | `#094b5a`        | `--bg-palette-active`      |
| Selected block                         | `#c0e6fd`                                         | `#0a3d4b`        | `--bg-block-selected`      |
| Text selection                         | `#e4f2ff`                                         | `#338fff`        | `--bg-text-selection`      |
| Borders (popovers, tables, journals)   | `#ebeaeb`                                         | `#003947`        | `--border`                 |
| Left sidebar right edge                | `#f3f3f3`                                         | `#08404f`        | `--border-sidebar`         |

Text colors:

| Role                                             | Light            | Dark             | Token              |
| ------------------------------------------------ | ---------------- | ---------------- | ------------------ |
| Body and block text                              | `#171717`        | `#a4b5b6`        | `--fg`             |
| Page and journal titles                          | `#171717`        | `#93a1a1`        | `--fg-title`       |
| Sidebar labels, popover text                     | `#020817`        | `#f2f2f2`        | `--fg-strong`      |
| Popup rows (slash, autocomplete)                 | `#020817` at 75% | `#f2f2f2` at 75% | `--fg-popup`       |
| Popup group headings                             | `#020817` at 20% | `#f2f2f2` at 20% | `--fg-popup-group` |
| Muted (palette group titles)                     | `#6f6f6f`        | `#a0a0a0`        | `--fg-muted`       |
| Subtle (table headers, sidebar item actions)     | `#858585`        | `#7e7e7e`        | `--fg-subtle`      |
| Links, refs, tags, markers                       | `#1b6898`        | `#9bd3d4`        | `--fg-link`        |
| Link hover                                       | `#1a537c`        | `#d0e8e8`        | `--fg-link-hover`  |
| Controls: toggle arrow, list numbers, time spent | `#433f38`        | `#a4b5b6`        | `--fg-control`     |

`<html>` carries `data-theme="light"` or `data-theme="dark"`, always the resolved theme. Colors switch through `color-scheme` and `light-dark()`; the few number tokens that differ per theme (header icon opacity, graph thumb opacity) are overridden under `:root[data-theme="dark"]`.

## Typography

[2x]

- **Font:** Inter, the variable font (Logseq uses weight 650 for task markers, so it is variable). seqno ships `@fontsource-variable/inter` 5.3.0, family `"Inter Variable"` (`--font-sans`). `index.html` links `theme.css`, which imports the faces, and `main.tsx` waits for the regular and italic faces before the first render (see the note under [Motion](#motion)).
- **Mono:** `"Fira Code", Monaco, Menlo, Consolas, "Courier New", monospace` (`--font-mono`). Inline code lists MonoLisa first; neither MonoLisa nor Fira Code is bundled, so both fall back to the system mono.
- **Base:** 16px / 24px, weight 400, `--fg`.
- `-webkit-font-smoothing: antialiased` on the left sidebar items (only matters on macOS).

| Size token                  | px / line height | Used for                             |
| --------------------------- | ---------------- | ------------------------------------ |
| `--text-xs`, `--leading-xs` | 12 / 16          | group headings, kbd, tooltip label   |
| `--text-sm`                 | 14 / 20          | sidebar items, menus, popups, tables |
| `--text-base`               | 16 / 24          | body and block text                  |
| `--text-lg`                 | 20 / 28          | search palette input                 |
| `--text-title`              | 36 / 54          | page and journal titles              |
| `--text-h1`                 | 32 / 48          | `#` heading block [classic]          |
| `--text-h2`                 | 24 / 36          | `##` heading block [classic]         |
| `--text-h3`                 | 19.2 / 28.8      | `###` heading block [classic]        |
| `--text-tag`                | 14.4 / 21.6      | `#tag` (0.9em)                       |
| `--text-inline-code`        | 14.4 / 20.88     | inline code (0.9em) [classic]        |
| `--text-marker`             | 13.6 / 20.4      | TODO, DOING… (0.85em) [classic]      |
| `--text-code`               | 14 / 23.2        | code block lines [classic]           |

Weights: 400 text, 500 (`--weight-medium`) titles, nav items, labels, property keys; 600 (`--weight-semibold`) headings; 650 (`--weight-marker`) task markers; 700 bold and palette group titles.

## Header bar

[2x]

- `#head`: 48px tall (`--header-height`), full width, transparent, above the sidebars (z-index 10). The left sidebar runs underneath it from y = 0.
- **Left group**, over the left sidebar: menu `IconMenu2` at (8, 8), search `IconSearch` at (40, 8). The menu button toggles the left sidebar; search opens the palette.
- **Right group**, against the right edge of the main area (6px inset): `IconDots` at x = 1370, `IconLayoutSidebarRight` at x = 1402, 32px apart with no gap. On a page that is not the journals home, `IconHome` sits left of the dots (x = 1338). With the right sidebar open, the group moves to the right edge of the main area (dots at 794, toggle at 826 with a 576px sidebar).
- **Icon button:** 32×32 (`--header-button-size`), padding 4px, radius 6px, 20px Tabler icon (`--icon-header`), color `--fg`. Opacity 0.7 / 0.6 (`--opacity-header-icon`). Hover: background `--bg-button-hover`, opacity 1 / 0.9 (`--opacity-header-icon-hover`).
- Every header button has a tooltip with its name and shortcut (see [tooltips](#buttons-menus-dropdowns-tooltips)).
- **Help button:** bottom right, a 32×32 circle at (1376, 852), background `--bg-sidebar`, a bold "?".

## Left sidebar

[2x]

- 246px wide (`--left-sidebar-width`), full height, background `--bg-sidebar`, right border 1px `--border-sidebar`.
- **Collapse:** `t l` or the header menu button. The inner panel slides out with `transform: translateX(-246px)` and the outer column shrinks to 0 width, both 150ms `--ease-standard`. The content column re-centers. A fresh 2.x window at 1440px opens with the sidebar closed; seqno defaults to open and persists the choice (`leftSidebarOpen`).
- Everything is inset 12px: rows are 221px wide starting at x = 12.

| Row                                           | Box                                     | Content                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Graph switcher                                | y = 52, 32px, padding 4 16 4 4, r 6px   | 24×24 thumb (radius 4px, background `#ededed / #094b5a`, opacity 0.8 / 0.5 `--opacity-graph-thumb`, `IconTopologyStar`), graph name 14px / 500 `--fg-strong`, `IconSelector` at the right. Row opacity 0.9, gap 4px.           |
| Group header (Navigations, Favorites, Recent) | 32px, padding 0 4 0 8, radius 6px       | 12px / 16px, weight 500, `--fg-strong` at opacity 0.5. Favorites and Recent have a collapse chevron (`IconChevronRight`, rotated when open) and an edit action that fades in on hover (opacity transition 150ms, 300ms delay). |
| Nav item                                      | 32px, 2px apart, padding 0 2 0 6, r 6px | 16px icon (`--icon-nav`, opacity 0.7, 8px right margin), label 14px / 20px / 500 `--fg-strong`, row opacity 0.8. Active and hover: background `--bg-hover`. On hover a kbd hint shows at the right (see kbd).                  |
| Recent item                                   | 32px, no gap, padding 0 8px, r 6px      | `IconFile` 16px at opacity 0.7, label 14px / 500, opacity 0.8. Hover: `--bg-hover`.                                                                                                                                            |

- Nav icons: Journals `IconCalendar`, Flashcards `IconCards`, Pages `IconFiles`, Graph view `IconHierarchy`.
- Vertical rhythm: Navigations header at y = 88, nav items at 124, 158, 192, 226; Favorites header near 266; Recent header near 302; first recent item at 334.

## Right sidebar

[2x]

- 40% of the window (`--right-sidebar-width`, 576px at 1440, max 864px), full height, background `--bg-sidebar`. Opens and closes by animating `width` over 300ms. A 3px resizer on its left edge (`cursor: col-resize`) tints on hover after a 300ms delay.
- Toggle: `t r` or `IconLayoutSidebarRight`. With nothing open, 2.x shows a "Contents" item.
- **Top bar:** 48px, padding 0 4px. Tab buttons ("Contents", "Page graph", "Help"): 14px / 20px, padding 4px 10px, radius 6px, background `--bg-sidebar-tab` (`#f7f7f7 / #023643`), hover `--bg-button-hover`.
- **Item list:** padding 0 8px 150px, pulled up 8px and in 4px. An 8px drop indicator sits between items.
- **Item card:** radius 6px, background `--bg-sidebar`, `--shadow-dialog`.
  - Header: 32px, background `--bg-sidebar-item-header`, radius 6px 6px 0 0. A button fills it (padding 0 8px): collapse arrow (18×16, opacity 0.5 on header hover), then the title, 14px / 20px / 500, with an icon before it (gap 4px).
  - Actions at the right: two 32×32 buttons (`IconDots`, `IconX`), padding 8px, radius 6px, 18px icons, color `--fg-subtle`.
  - Content: padding 8px 8px 0; the page or block renders inside with its own blocks.
- Shift-click on a page ref, tag, block ref or bullet adds that page or block to the top of the list and opens the sidebar. seqno: `NavigationTarget` `SidebarPage` / `SidebarBlock`, state in the `rightSidebar` atom.

## Main column

[2x]

- `#main-content-container`: padding 32px 16px 32px 32px (`--main-padding-*`).
- Content column: max 960px (`--content-max-width`; wide mode `t w` uses 1440px, `--content-max-width-wide`), centered in the space between the sidebars. Left sidebar open: x = 371 to 1331. Closed: x = 248 to 1208.
- Page inner padding 0 8px (`--page-padding-inline`), so titles start at x = 379 and their text at 381.

## Page title and journal title

[2x]

- 36px / 54px, weight 500, `--fg-title` (`--text-title`). [classic] uses the same size and weight with 16px below.
- In 2.x the title row is itself a block: 58px tall (2px padding above and below the 54px line).
- Title to first block: 48px (`--title-to-blocks`), a 32px grid gap plus the blocks' 16px top margin.
- Journal titles in the journals list are the same title, and click through to the day's page.

## Journals list

[2x]

- Each day is a `.journal-item`, the full 960px column, padding-bottom 102px (`--journal-padding-bottom`).
- The first (today) has min-height 500px (`--journal-first-min-height`). The rest are separated by a 1px top border in `--border`; `--journal-min-height` (250px) comes from the first study pass and was not re-measured.
- Below the blocks 2.x shows a linked-references area (not measured).

## Block row

[2x]

```
 x0      x0+22        x0+42
 ├─ 22 ─┼─ 16 ─┤ 4 ├──── content ─────────────────────────
 │  ▾   │  •   │   │ Morning check in the [[projects/Greenhouse]]
 │      │  ┊   │   │
         x0+29: 1px guide line (children's left border)
               └── child row starts at x0 + 30
```

- `.ls-block`: padding 2px 0, so a one-line block is 28px tall (`--block-row-height`) and one-line siblings stack 28px apart. No margins between blocks.
- The blocks container sits 20px left of the title (`margin-left: -20px`), which puts the bullet's 16px box exactly under the title's first letter (x = 381).
- Row: a 38px control column (22px toggle + 16px bullet box), 4px gap (`--bullet-gap`), then the content. The control column is 24px tall, centered on the first line.
- **Bullet box:** 16×16 (`--bullet-box`), round. **Dot:** 6.4×6.4 (`--bullet-size`), round, `--bullet` (`#c7c7c7 / #608e91`), opacity 0.8 (`--opacity-bullet`), `transition: transform 200ms`.
- **Bullet hover:** the dot scales to 1.2 (`--bullet-hover-scale`) and the box fills with `--bg-bullet-halo` (`#dedede / #0f4958`). Cursor pointer. Click zooms into the block; shift-click opens it in the right sidebar.
- **Collapsed block:** the box keeps the `--bg-bullet-halo` fill at rest. That ring is the only sign of hidden children. [classic: a 6px dot in the same 16px halo.]
- **Toggle arrow:** only for blocks with children, shown while the row is hovered. A 22×22 control (padding 2px, 1px top margin, opacity 0.4 `--opacity-block-control`) holding a 16px filled caret in `--fg-control`. Pointing right when collapsed; rotated 90° to point down when expanded, `transition: transform 100ms ease-in`.
- **Children:** the children container is indented 29px with 2px top padding and −2px bottom margin. It draws a 1px left border in `--guide` (`rgb(46 27 5 / 0.08)` / `#0b4a5a`), so the guide line runs under the parent's bullet center. Each level indents 30px (`--block-indent`).
- **Numbered list** [classic]: a block with `logseq.order-list-type:: number` replaces its dot with "1.", "2."… in a 22×16 box, 15px, `--fg-control` at opacity 0.8.

## Block text

[2x]. Blocks and the editor both build to this.

- Inter 16px / 24px (`--text-base`, `--leading-base`), weight 400, `--fg`, `white-space: pre-wrap`, wraps at the content width, `cursor: text`.
- Wrapped lines start at the content's left edge (no hanging indent).
- The rendered block and the editor occupy the same box: content at x = 401, 914px wide, 24px per line, in both states. Entering edit mode must not move a single glyph except where markup becomes visible.
- Bold 700, italic uses Inter's italic face, `~~strike~~` is `line-through`.
- Paragraph breaks inside one block (`\n`) are plain line breaks at the same 24px rhythm.

## Inline elements

| Element                       | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Page ref `[[x]]`              | Text in `--fg-link`, `transition: 300ms`, pointer. The `[[` and `]]` brackets render in `--fg-bracket` (`#6b7280`) at opacity 0.3 (`--opacity-bracket`), same size. `t b` hides brackets. Hover: `--fg-link-hover`.                                                                                                                                                                                                                                                                                                                                                              | [2x], [classic] |
| Namespaced ref `[[a/b]]`      | Same as a page ref, full name shown with the slash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [classic]       |
| Tag `#x`, `#[[x y]]`          | `#` plus name, 14.4px / 21.6px (`--text-tag`), `--fg-link`, padding 0 2px, radius 4px, opacity 0.8, hover opacity 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | [2x], [classic] |
| Block ref `((id))`            | The referenced block's text inline, in `--fg`, with a 1px bottom border in `--border-block-ref` (`#d8e1e8 / #1a6376`), padding 2px 0, `cursor: alias`.                                                                                                                                                                                                                                                                                                                                                                                                                           | [classic]       |
| Embed `{{embed ((id))}}`      | A box with background `--bg-embed` (`#f8f8f8 / #023643`), inner padding 4px 12px 8px, holding the embedded block and its children as a normal block tree.                                                                                                                                                                                                                                                                                                                                                                                                                        | [classic]       |
| Task checkbox                 | 16×16 before the marker, 5px right margin, filled `--bg-checkbox` (`#9dbbd8 / #6093a0`), color transitions 150ms. Checked for DONE.                                                                                                                                                                                                                                                                                                                                                                                                                                              | [classic]       |
| Task marker                   | 13.6px / 20.4px (`--text-marker`), weight 650, padding 2px 4px, opacity 0.7 (`--opacity-marker`). TODO, DOING, LATER, NOW: `--fg-link`, 2px right margin, clickable (cycles). WAIT, WAITING, IN-PROGRESS: `--fg`, 3.5px right margin, not clickable.                                                                                                                                                                                                                                                                                                                             | [classic]       |
| DONE                          | Checked checkbox, no marker word, the text in `line-through` at opacity 0.7 (`--opacity-done`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [classic]       |
| CANCELED, CANCELLED           | No checkbox, no marker word, the whole text `line-through` at opacity 0.7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [classic]       |
| Priority `[#A]`               | Shown as `[#A]`, 16px, `--fg-link`, opacity 0.5 (`--opacity-priority`), 3.5px right margin, a link.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [classic]       |
| SCHEDULED, DEADLINE           | A 20px row under the block text, 14px / 20px. Label (`SCHEDULED:`) weight 500 at opacity 0.5; the date (`<2026-10-08 Thu .+1w>`) is a 14px `--fg-link` link at opacity 0.8.                                                                                                                                                                                                                                                                                                                                                                                                      | [classic]       |
| Properties `key:: value`      | One box under the text: background `--bg-properties` (`#f3f3f3 / #06323e`), padding 4px 8px, margin 4px 0, radius 4px. Per line: key weight 500 in `--fg-property-key` (`#161e2e / #dfdfdf`, pointer), `:` with 4px after it, value in `--fg` with refs rendered as page refs. Page properties render the same box as the first block.                                                                                                                                                                                                                                           | [classic]       |
| `:LOGBOOK:`                   | Hidden. A block with clock entries shows its total ("1h34m") at the far right of the row: 14px / 20px, 4px left margin, 3px top padding, a link in `--fg-control` at opacity 0.8. Clicking it toggles the drawer (drawer not measured).                                                                                                                                                                                                                                                                                                                                          | [classic]       |
| Highlight `==x==`             | Background `--bg-mark` `#fef3ac`, text `--fg-mark` `#262626` in both themes, padding 0 4px, radius 4px. [classic: 2px 4px, radius 3px.]                                                                                                                                                                                                                                                                                                                                                                                                                                          | [2x]            |
| Inline code                   | Mono 14.4px / 20.88px, `--fg-inline-code` (`#6f6f6f / #a4b5b6`) on `--bg-inline-code` (`#e2e2e2 / #01222a`), padding 3px 5px, radius 4px.                                                                                                                                                                                                                                                                                                                                                                                                                                        | [classic]       |
| Code block                    | Solarized. Mono 14px / 23.2px (`--text-code`), text `--fg-code` (`#657b83 / #839496`) on `--bg-code` (`#fdf6e3 / #002b36`), radius 2px. Gutter 31px, `--bg-code-gutter` (`#eee8d5 / #073642`), line numbers `--fg-code-line-number` (`#839496 / #586e75`) right-aligned, padding 0 5px. Lines padding 0 4px. Language label top right: 14px, padding 4px 6px, `--bg-code-lang` (`#f7f7f7 / #023643`), opacity 0.8. Tokens (both themes): keyword `#cb4b16`, string `#859900`, def and property `#2aa198`, variable `#839496`, number `#d33682`, operator `#6c71c4` (`--code-*`). | [classic]       |
| Quote `> x`                   | Background `--bg-quote` (`#f3f3f3 / #023643`), 4px left border in `--border`, padding 8px 20px, margin 8px 0, text `--fg-quote` (`#433f38 / #a4b5b6`).                                                                                                                                                                                                                                                                                                                                                                                                                           | [classic]       |
| Heading `#`                   | 32px / 48px, 600, padding-bottom 4px, margin 4px 0, 1px bottom border `--border-heading` (`#dcdcdc / #094b5a`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [classic]       |
| Heading `##`                  | 24px / 36px, 600, padding-bottom 3px, margin 3px 0, same bottom border.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [classic]       |
| Heading `###`                 | 19.2px / 28.8px, 600, no border.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [classic]       |
| Link `[x](url)`, bare URL     | `--fg-link` with a 1px bottom border in the same color, `transition: 300ms`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [classic]       |
| Image `![x](../assets/y.svg)` | Radius 4px, natural size up to the content width. Size and resize handles not measured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [classic]       |

2.x renders pasted `TODO` and `[#A]` as plain text (it keeps task state in properties), which is why markers come from classic.

## Editing block

[2x]

- The editor is a plain text area with exactly the block text metrics: Inter 16px / 24px, `--fg`, no border, no background, no padding, transparent outline. It sits in the same box as the rendered content (see [Block text](#block-text)).
- The raw markdown shows while editing: `[[Garden Plan]]` keeps its brackets in normal text color, `==x==` shows its markers.
- Caret: `caret-color` is the text color, 1px.
- Selection: background `--bg-text-selection` (`#e4f2ff / #338fff`), text `--fg-text-selection` (`#433f38 / #a4b5b6`). The same `::selection` applies app-wide (set in `theme.css`).
- The editing row gets no background.

## Block selection

[2x]

- Esc while editing selects the block; Esc again clears. Arrow keys with Alt or Shift extend.
- Selected block: background `--bg-block-selected` (`#c0e6fd / #0a3d4b`), radius 4px, the whole `.ls-block` box: from the toggle column to the right edge of the blocks area (964px wide at 1440), 28px tall for one line including its 2px padding.
- `transition: background-color 200ms cubic-bezier(0, 1, 0, 1)` (`--ease-select`).

## Autocomplete popup

[2x], opened by typing `[[Gar` in a block.

- Anchored under the caret's line: top = line bottom + 3px. Left near the caret, kept inside the window.
- Frame: background `--bg-popover`, 1px `--border`, radius 6px, padding 6px, `--shadow-popover`, text `--fg-strong`. Width 512px for page search.
- Rows: 32px for one line, padding 6px 8px, radius 4px, 14px / 20px, `--fg-popup`, `transition: opacity 150ms`. Chosen row: `--bg-popup-active`. ↑ ↓ (or Mod+P, Mod+N) move it, Enter picks, Shift+Enter opens in the sidebar.
- Page rows: a 14px icon (`IconHash` for tags, `IconFile` for pages) then the name; the matched characters are wrapped in a mark with `--bg-mark` / `--fg-mark` and no padding. "New page Gar" row with `IconPlus`.
- Block rows: a 12px / 16px breadcrumb line at opacity 0.7 with 4px below it ("Oct 6th, 2026 / Morning check in the …"), then a bullet and the block text at 14px. Rows grow to 52px or 72px when the text wraps.
- The list scrolls inside the popup with its scrollbar hidden.

## Slash menu

[2x], opened by typing `/` in a block.

- Same frame as the autocomplete popup, 288px wide, at most 480px tall; scrolls inside with the scrollbar hidden.
- Group headings ("BASIC", "FORMAT", "Heading"): 32px, padding 8px, 12px / 16px, weight 500, `--fg-popup-group`. The heading text is written in capitals, not transformed.
- Items: 32px, padding 6px 8px, radius 4px, 14px / 20px, `--fg-popup`. An 18px box with a 14px Tabler icon at opacity 0.7 (`--opacity-popup-icon`), 1px right margin, then the label with a 4px gap.
- Chosen item: `--bg-popup-active`. Hovering an item makes it chosen; its text goes to full `--fg-strong`.
- 2.x's items (Node reference, Node embed, Link, Image link, Underline, Code block, Quote, Math block, Normal text, Heading 1–6, …) are 2.x commands. For markdown graphs, classic's command list is the better source for the items themselves (TODO, DOING, Page reference, Block reference, Embed, Date picker, Today, …); keep 2.x's styling.

## Search palette

[2x], `Mod+K` or the header search button.

- **Overlay:** fixed, full window, `--bg-overlay` (white or `#002d38` at 90%), no blur.
- **Dialog:** 896px wide (max 90vw), top edge at y = 126, 703px tall. Background `--bg-popover`, 1px `--border`, radius 8px, `--shadow-dialog`. Enters with opacity 0 → 1 and scale 0.95 → 1 over 200ms.
- **Input row:** 53px, background `--bg-input` (`#f8f8f8 / #023643`), 1px bottom border `--border-input` (`#dbdbdb / #0e5263`). Input 20px / 28px (`--text-lg`), padding 12px, no ring, no border.
- **Results:** a scroll area of 65% of the window height with 56px bottom padding. Groups are separated by a 1px line (`--border-separator`).
  - Group header, 32px: title 12px / 16px bold in `--fg-muted` ("Nodes"), then the count in `--fg` ("2").
  - Row: margin 0 2px, padding 6px 12px, radius 8px, 32px for one line, 46px with the 12px page line above the text. A 20×20 icon tile (radius 4px, `--bg-icon-tile` `#e8e8e8 / #094b5a`), 12px gap, then the title 14px / 20px / 500 in `--fg-palette-item` (`#171717 / #ededed`). Secondary text ("— Create page called 'greenhouse'") is 12px muted.
  - Active row: `--bg-palette-active`, plus a 1px inset ring in `--border-palette-active` (light only).
  - Matches: mark with `--bg-mark` / `--fg-mark`, weight 500.
- **Footer:** "Tip:" with a kbd hint on the left and "Create ⏎" on the right, background `--bg-footer` (`#f3f3f3 / #023643`), padding 8px 12px, 1px top border.

## Buttons, menus, dropdowns, tooltips

[2x]

**Dropdown menu** (header `IconDots`):

- Opens below its trigger, right edge kept 11px inside the window. 256px wide (min 128px).
- Frame: `--bg-popover`, 1px `--border`, radius 6px, padding 4px, `--shadow-popover`.
- Items: 32px, padding 6px 8px, radius 4px, 14px / 20px, weight 400, `--fg`. Optional 18px icon (`--icon-menu`) with a 4px gap. Hover and keyboard focus: background `--bg-menu-active`, text `--fg-menu-active`.
- Separator: 1px, margin 4px −4px, `--border-separator`.
- Icons in the header menu: `IconSettings`, `IconApps`, `IconColorSwatch`, `IconTrash`, `IconDatabaseExport`, `IconFileUpload`, `IconUser`.

**Tooltip** (hover a header button):

- 4px below the trigger, kept inside the window. `--bg-popover`, 1px `--border`, radius 6px, padding 6px 12px, `--shadow-popover`.
- Label 12px / 16px, `--fg-strong` at opacity 0.8. Under it the shortcut keys in a row (gap 4px).

**kbd chip:** 20px tall, 12px / 16px, letter-spacing −0.5px (`--tracking-kbd`), padding 2px 4px, radius 4px, background `--bg-kbd` (black at 11.4% / white at 13%), text `--fg-kbd`, inset top and bottom shadows `--shadow-kbd`. In tooltips it also has a 1px border in the same color as its background. `transition: transform, box-shadow, filter 140ms ease-out`.

**Ghost icon button:** see [Header bar](#header-bar). **Text button** (right sidebar tabs): 14px, padding 4px 10px, radius 6px, `--bg-sidebar-tab`, hover `--bg-button-hover`.

## All pages

[2x], `g a`.

- A table that uses the wide layout (x = 278 to 1424 with the left sidebar open).
- View header, 28px: "All 17" with a count, and filter, sort, search, layout and more icons at the right.
- Header row: 34px, 1px top and bottom borders in `--border`, background `--bg-app`. Header cells 14px / 20px / 500 in `--fg-subtle`.
- Rows: 33px min, 1px bottom border `--border`, 14px / 20px `--fg`, background `--bg-app`.
- Columns: a 32px checkbox column, Page name, Backlinks, Tags, Created At, Updated At.

## Scrollbars

[2x]

- 6px wide (`--scrollbar-width`), 8px tall when horizontal (`--scrollbar-height`).
- Track `--scrollbar-track` (`#f8f8f8` / `rgb(30 60 67 / 0.1)`), thumb `--scrollbar-thumb` (`#e8e8e8 / #11505f`), pressed thumb `--scrollbar-thumb-active` (`#e2e2e2` / white at 20%), corner transparent.
- `theme.css` sets these on every scroll container with `::-webkit-scrollbar`. Don't set `scrollbar-width` or `scrollbar-color` anywhere: in Chrome they switch the `::-webkit-scrollbar` styles off.
- The left sidebar's groups hide their scrollbar until hovered. Popups (slash, autocomplete) hide it entirely.

## Focus rings

[2x]

- Buttons on `:focus-visible`: a 2px ring in the background color, then a 2px ring in `--ring-color` (`#037dba`): `box-shadow: var(--ring)`, with `--ring-offset` `#ffffff / #002d38`. `theme.css` applies it to `button:focus-visible`.
- The header's two left icon buttons keep Chrome's default focus outline.
- The palette input and the block editor show no ring.

## Motion

| What                                       | Property                                        | Duration                          | Easing            | Source          |
| ------------------------------------------ | ----------------------------------------------- | --------------------------------- | ----------------- | --------------- |
| Left sidebar                               | inner `transform`, column `width`               | 150ms                             | `--ease-standard` | [2x]            |
| Right sidebar                              | `width`                                         | 300ms                             | ease              | [2x]            |
| Right sidebar resizer tint                 | `background-color`                              | 200ms, 300ms delay                | `--ease-standard` | [2x]            |
| Bullet hover scale                         | `transform`                                     | 200ms                             | ease              | [2x]            |
| Block (drag, move)                         | `transform`                                     | 300ms                             | ease              | [2x]            |
| Block selection                            | `background-color`                              | 200ms                             | `--ease-select`   | [2x]            |
| Toggle arrow rotation                      | `transform`                                     | 100ms                             | ease-in           | [2x]            |
| Links, refs, tags, markers, priorities     | all (color, opacity)                            | 300ms                             | ease              | [2x], [classic] |
| Popup rows                                 | `opacity`                                       | 150ms                             | `--ease-standard` | [2x]            |
| Checkbox                                   | colors, shadow, transform                       | 150ms                             | `--ease-standard` | [classic]       |
| kbd chip                                   | `transform`, `box-shadow`, `filter`             | 140ms                             | ease-out          | [2x]            |
| Sidebar group action                       | `opacity`                                       | 150ms, 300ms delay                | `--ease-standard` | [2x]            |
| Search dialog enter                        | `opacity` 0 → 1, `scale` 0.95 → 1               | 200ms                             | ease              | [2x]            |
| Popover enter (slash, autocomplete, menus) | `opacity` 0 → 1, `scale` 0.95 → 1, 8px slide in | caught mid-animation, about 150ms | —                 | [2x]            |

**Fonts before first paint.** `index.html` links `theme.css` (tokens plus the Inter faces) so it loads before any script, and `main.tsx` waits for `document.fonts.load` (regular and italic) before rendering. When Inter swapped in after the outliner had measured its rows, headless Chrome 153's renderer crashed (a compositor CHECK, SIGTRAP) on the showcase page about half the time. Loading the fonts first removed it in every run. If a page ever crashes with "Target crashed", suspect a mass relayout during the outliner's row measuring.

## Keyboard shortcuts

From the 2.x keymap (Linux labels). `Mod` is Ctrl on Linux and Windows, Cmd on macOS. Two-letter shortcuts like `t t` are typed in sequence outside the editor.

**UI toggles**

| Keys          | Action                         |
| ------------- | ------------------------------ |
| `t t`         | Toggle dark and light theme    |
| `t l`         | Toggle left sidebar            |
| `t r`         | Toggle right sidebar           |
| `t w`         | Toggle wide mode               |
| `t o`         | Collapse or expand all blocks  |
| `t b`         | Toggle `[[ ]]` brackets        |
| `t n`         | Toggle number list             |
| `t s`         | Toggle settings                |
| `c c`         | Customize appearance           |
| `?`           | Toggle help                    |
| `Alt+Shift+C` | Toggle Contents in the sidebar |

**Search and navigation**

| Keys              | Action                                  |
| ----------------- | --------------------------------------- |
| `Mod+K`           | Search pages and blocks                 |
| `Mod+Shift+K`     | Search blocks in the page               |
| `Mod+Shift+P`     | Search commands                         |
| `g j`             | Go to journals                          |
| `g h`             | Go to home                              |
| `g a`             | Go to all pages                         |
| `g g`             | Go to graph view                        |
| `g s`             | Go to keyboard shortcuts                |
| `g n` / `g p`     | Next / previous journal                 |
| `g t`             | Go to tomorrow                          |
| `g f`, `t c`      | Flashcards                              |
| `g Shift+G`       | All graphs                              |
| `Mod+[` / `Mod+]` | Back / forward                          |
| `Alt+Shift+J`     | Open today in the right sidebar         |
| `c t`             | Close the top item in the right sidebar |
| `Mod+C Mod+C`     | Clear the right sidebar                 |
| `Mod+Shift+F`     | Add to or remove from favorites         |

**Editing**

| Keys                              | Action                            |
| --------------------------------- | --------------------------------- |
| `Enter` / `Shift+Enter`           | New block / new line in the block |
| `Tab` / `Shift+Tab`               | Indent / outdent                  |
| `Mod+Enter`                       | Rotate TODO state                 |
| `Alt+Shift+↑` / `↓`               | Move block up / down              |
| `Mod+↑` / `Mod+↓`                 | Collapse / expand                 |
| `Mod+;`                           | Toggle expand or collapse         |
| `Mod+O`                           | Follow the link under the cursor  |
| `Mod+Shift+O`                     | Open the link in the sidebar      |
| `Alt+→` / `Alt+←`                 | Zoom in / out                     |
| `Mod+B`, `Mod+I`                  | Bold, italic                      |
| `Mod+Shift+H`, `Mod+Shift+S`      | Highlight, strikethrough          |
| `Mod+L`                           | Link                              |
| `Mod+Z`, `Mod+Shift+Z` or `Mod+Y` | Undo, redo                        |
| `Shift+↑` / `Shift+↓`             | Select up / down from the text    |
| `Esc`                             | Leave editing, select the block   |

**Block selection**

| Keys                  | Action                            |
| --------------------- | --------------------------------- |
| `Alt+↑` / `Alt+↓`     | Select the block above / below    |
| `Mod+Shift+A`         | Select all blocks                 |
| `Mod+A`               | Select the parent block           |
| `Enter`               | Edit the selected block           |
| `Shift+Enter`         | Open the selection in the sidebar |
| `Backspace`, `Delete` | Delete the selection              |

**Autocomplete:** `Enter` (or `Mod+Enter`) picks, `↑` `↓` or `Mod+P` `Mod+N` move, `Shift+Enter` opens in the sidebar.

## Not measured yet

- The expanded `:LOGBOOK:` drawer and the property autocomplete.
- Image sizing and resize handles (the probe page's SVG did not load; the harness now serves it).
- Linked and unlinked references under a page (2.x and classic).
- The right sidebar's page title size and spacing inside an item.
- Classic's all pages table; the graph switcher dropdown; settings; date picker; toasts; drag and drop indicators; bullet context menu.
- Exact popover enter timing (captured mid-animation only).
