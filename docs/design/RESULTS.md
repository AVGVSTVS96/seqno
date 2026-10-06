# Design foundation: results

The shared pieces the Logseq look-alike work builds on. All of it is on `main`.

| Piece              | Where                                                    | State                                                                     |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Measured spec      | `docs/design/SPEC.md`                                    | 22 surfaces, light and dark, each value tagged [2x] or [classic]          |
| Design tokens      | `apps/web/src/theme.css`                                 | about 170 custom properties, linked from `index.html`                     |
| Inter and Tabler   | `apps/web`, `features/outliner`, `features/editor`       | `@fontsource-variable/inter` 5.3.0, `@tabler/icons-react` 3.49.0          |
| Shared state       | `apps/web/src/atoms.ts`                                  | `theme`, `resolvedTheme`, `leftSidebarOpen`, `searchOpen`, `rightSidebar` |
| Sidebar navigation | `features/outliner` `NavigationTarget`                   | `SidebarPage`, `SidebarBlock` on shift-click                              |
| Dependency rule    | `tools/lint/src/boundaries.ts`, `AGENTS.md`              | UI may import `@seqno/syntax` and `@seqno/query`                          |
| Showcase graph     | `fixtures/graphs/showcase`, `fixtures/src/cases.ts`      | 3 journals, 6 pages, every element                                        |
| Design harness     | `tools/e2e/design`, documented in `tools/e2e/RESULTS.md` | 10 scenes × 2 themes × 2 apps, `compare.html`                             |

## How the theme works

```
index.html ──link──▶ theme.css ── @import Inter (regular + italic)
                         │        :root tokens, light-dark() colors
                         │        [data-theme=dark] number overrides
                         ▼
main.tsx: registry.subscribe(resolvedTheme) ──▶ <html data-theme="light|dark">
          await document.fonts.load(Inter regular, italic)   then render
```

- `theme` is `"light" | "dark" | "system"`, persisted as JSON in localStorage (`seqno.theme`) through `Atom.kvs`. `resolvedTheme` folds in `prefersDark`, which `main.tsx` keeps in sync with `prefers-color-scheme`. `<html data-theme>` always holds the resolved value, like Logseq's.
- Colors switch through `color-scheme` and `light-dark()`, so each color token is one line. Number tokens that differ per theme live under `:root[data-theme="dark"]`.
- `leftSidebarOpen` persists the same way (`seqno.leftSidebar`). `rightSidebar` is an ordered list (newest first, no duplicates) driven by `Open`, `Close`, `Toggle` and `Clear` actions. `searchOpen` is a plain boolean for the palette.

## What matches Logseq now

Compared in `tools/e2e/design-out/compare.html` (all 10 scenes, light and dark, both apps captured on 2026-10-06):

- Background layers and text colors in both themes: app, sidebars, body text, link color, title color.
- Font: Inter variable at 16px / 24px for body and block text, the same face Logseq uses.
- Selection colors, focus ring, and WebKit scrollbars (6px, Logseq's colors) app-wide.
- Shift-click opens a page or block in the right sidebar, and the left sidebar state persists.

Everything else in the app still has its phase 1 layout. The pairs make each gap obvious.

## What doesn't match yet

By owner area, most visible first:

- **Shell:** no header bar (Logseq: 48px, menu and search on the left, dots and sidebar toggle on the right); the left sidebar has no graph switcher, icons, group headers or recent list; "Show sidebar" is a text button; the right sidebar has no top bar or item cards; all pages is a bullet list, not Logseq's table; page titles are 25.6px bold instead of 36px / 500, with a "Star" button Logseq doesn't show.
- **Blocks:** bullets are plain dots (Logseq: 6.4px dot in a 16px box, halo on hover and when collapsed, toggle arrow on hover); 30px rows and a 24px indent (Logseq: 28px rows, 30px indent); markers render as small labels without checkboxes; DONE and CANCELED are not struck through; priorities, SCHEDULED, DEADLINE, properties and the logbook show as raw text; highlight is pure yellow; code blocks have no Solarized colors, gutter or language label; headings lack their bottom borders; the outliner still uses its own markdown parser.
- **Editor:** CodeMirror shows the block in a monospace font with a different line height, so text jumps on edit; the `[[` popup is a bare blue list; there is no slash menu.
- **Search:** no Mod+K palette; search is a sidebar page.

## Scenes compared

`journals`, `showcase-top`, `showcase-lower`, `editing`, `autocomplete`, `slash`, `search`, `right-sidebar`, `left-sidebar-collapsed`, `all-pages`, each in light and dark. The seqno side currently reports `missing: slash menu`, `missing: search palette on Mod+K`, and on some runs `missing: page autocomplete` (the editor's popup has no `listbox` role yet).

## Tokens added after the first pass

Re-measuring changed or added these (all in `theme.css`):

- Fixed: `--bg-button-hover` dark `#08404f`, `--ring-offset` dark `#002d38`, `--bg-palette-active` light `#e2e2e2`.
- Added: `--opacity-header-icon`, `--opacity-header-icon-hover`, `--opacity-graph-thumb`, `--opacity-popup-icon`, `--opacity-block-control`, `--bullet-hover-scale`, `--scrollbar-height`, `--scrollbar-thumb-active`, `--bg-sidebar-tab`, `--fg-menu-active`, `--fg-palette-item`, `--fg-control`, `--border-palette-active`.

Leads who need a token that's missing add it in their own CSS and list it in their RESULTS.md, as the plan says.

## Tests

- `pnpm check`: lint, format, typecheck, 334 tests in 29 files, all passing.
- E2E flows against a build on port 4181: 12 passed, 1 skipped (the on-demand screenshot flow).
- New tests: `apps/web/test/atoms.test.ts` (theme and sidebar persistence, system theme resolution, right sidebar actions), `features/outliner/test/outliner.test.tsx` (shift-click asks for the sidebar), `tools/lint/test/rules.test.ts` (UI may import pure packages, still not core ones), `fixtures/test/cases.test.ts` (the showcase graph keeps every element).

## Known issues

- **A Chrome renderer crash, now avoided.** With Inter swapping in after the outliner measured its rows, headless Chrome 153 crashed the tab (compositor CHECK, SIGTRAP) on the long showcase page in about half the runs. Loading the fonts before the first render fixed it in every run since. If a "Target crashed" shows up again, suspect a mass relayout during the outliner's row measuring.
- **Logseq 2.x quirks** in the references are listed in `tools/e2e/RESULTS.md` (empty namespaced refs, plain-text markers).
- `/tmp` on this machine filled up during the run (other projects); the harness and tests honor `TMPDIR`.
