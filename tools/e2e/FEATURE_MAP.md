# seqno feature map

Every user-facing feature in phases 1 and 2, how a person reaches it, and the Playwright flow that proves it works. Agents verifying a feature start here (see `.claude/skills/verify-web/SKILL.md`).

- **Phase 1** is the app skeleton: shell, journals, the outliner, the block editor and local persistence.
- **Phase 2** is everything built on the index, query, vault-folder and interop packages: references, search, queries, folders, import, sync.
- **Keys** are Logseq's defaults, which seqno keeps. `Mod` is Ctrl on Linux and Windows, Cmd on Mac. Where Mac differs it is noted.
- **Status**: `skipped` means the flow is written and waits on `apps/web`; `planned` means the file does not exist yet. A flow is `passing` once it runs green in CI.

## Shell and journals

| Feature                                                    | Phase | How to reach it                                       | Owner        | Flow                                     | Status  |
| ---------------------------------------------------------- | ----- | ----------------------------------------------------- | ------------ | ---------------------------------------- | ------- |
| App opens with no uncaught errors, tab titled `seqno`      | 1     | open `/`                                              | `@seqno/web` | `flows/journal.e2e.ts` › open app        | passing |
| Today's journal shows on open, titled like `Oct 6th, 2026` | 1     | open `/`                                              | `@seqno/web` | `flows/journal.e2e.ts` › journal visible | passing |
| Earlier journals below today's                             | 1     | scroll down on `/`, or `g j`                          | `@seqno/web` | `flows/journal.e2e.ts`                   | planned |
| Open a page by URL, back and forward work                  | 1     | `/page/<name>`, browser back / forward                | `@seqno/web` | `flows/pages.e2e.ts`                     | planned |
| All pages list                                             | 2     | `g a`                                                 | `@seqno/web` | `flows/pages.e2e.ts`                     | planned |
| Right sidebar                                              | 2     | `t r`; Shift+click a page or block ref opens it there | `@seqno/web` | `flows/pages.e2e.ts`                     | planned |

## Editing a block

| Feature                                                                           | Phase | How to reach it                                              | Owner           | Flow                                                                      | Status  |
| --------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------- | ------- |
| Type in a block                                                                   | 1     | click a block, type                                          | `@seqno/editor` | `flows/journal.e2e.ts` › type in a block                                  | passing |
| Text survives a reload (saved to OPFS)                                            | 1     | type, reload the tab                                         | `@seqno/web`    | `flows/journal.e2e.ts` › reload keeps text                                | passing |
| Leave the editor; the block renders as static content                             | 1     | Esc, or click elsewhere                                      | `@seqno/editor` | `flows/journal.e2e.ts` › type in a block                                  | passing |
| Markdown live styling while editing (`**bold**`, `_italic_`, `` `code` ``, links) | 1     | type markdown in a block                                     | `@seqno/editor` | `flows/editor.e2e.ts`                                                     | planned |
| Page autocomplete                                                                 | 1     | type `[[`                                                    | `@seqno/editor` | `flows/editor.e2e.ts`                                                     | planned |
| Block ref autocomplete                                                            | 1     | type `((`                                                    | `@seqno/editor` | `flows/editor.e2e.ts`                                                     | planned |
| Tag autocomplete                                                                  | 1     | type `#`                                                     | `@seqno/editor` | `flows/editor.e2e.ts`                                                     | planned |
| New block (splits at the cursor)                                                  | 1     | Enter                                                        | `@seqno/editor` | `flows/journal.e2e.ts` › Enter splits a block and Tab indents the new one | passing |
| Line break inside a block                                                         | 1     | Shift+Enter                                                  | `@seqno/editor` | `flows/blocks.e2e.ts`                                                     | planned |
| Merge with the block above                                                        | 1     | Backspace at the start of a block                            | `@seqno/editor` | `flows/blocks.e2e.ts`                                                     | planned |
| Undo and redo                                                                     | 1     | Mod+Z, Mod+Shift+Z (Ctrl+Y also redoes on Linux and Windows) | `@seqno/graph`  | `flows/history.e2e.ts`                                                    | planned |
| Properties (`key:: value`) show as a property list                                | 2     | type `status:: draft` on its own line                        | `@seqno/editor` | `flows/properties.e2e.ts`                                                 | planned |
| Task markers cycle TODO → DOING → DONE                                            | 2     | Mod+Enter                                                    | `@seqno/editor` | `flows/properties.e2e.ts`                                                 | planned |
| Slash commands                                                                    | 2     | type `/`                                                     | `@seqno/editor` | `flows/editor.e2e.ts`                                                     | planned |

## Outliner

| Feature                                                  | Phase | How to reach it                                                                       | Owner             | Flow                       | Status  |
| -------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------- | ----------------- | -------------------------- | ------- |
| Move between blocks with the arrow keys                  | 1     | Up / Down on the first / last line of a block                                         | `@seqno/outliner` | `flows/outline.e2e.ts`     | planned |
| Indent and outdent                                       | 1     | Tab, Shift+Tab                                                                        | `@seqno/outliner` | `flows/outline.e2e.ts`     | planned |
| Move a block up or down                                  | 1     | Alt+Shift+Up / Down (Mac: Cmd+Shift+Up / Down)                                        | `@seqno/outliner` | `flows/outline.e2e.ts`     | planned |
| Drag a block by its bullet                               | 1     | drag the bullet onto another block                                                    | `@seqno/outliner` | `flows/outline.e2e.ts`     | planned |
| Collapse and expand                                      | 1     | click the arrow left of the bullet, or Mod+Up / Mod+Down                              | `@seqno/outliner` | `flows/outline.e2e.ts`     | planned |
| Zoom into a block and back out                           | 1     | click the bullet, or Alt+Right / Alt+Left (Mac: Mod+. / Mod+,); breadcrumb to go back | `@seqno/outliner` | `flows/outline.e2e.ts`     | planned |
| Select blocks, then delete, indent or move them together | 1     | Esc selects the edited block, Shift+Up / Down or Shift+click extends                  | `@seqno/outliner` | `flows/outline.e2e.ts`     | planned |
| Long pages scroll smoothly (virtualized)                 | 1     | open a page with thousands of blocks                                                  | `@seqno/outliner` | `flows/large-graph.e2e.ts` | planned |

## Pages and references

| Feature                                         | Phase | How to reach it                                               | Owner           | Flow                                               | Status  |
| ----------------------------------------------- | ----- | ------------------------------------------------------------- | --------------- | -------------------------------------------------- | ------- |
| Follow a page link                              | 1     | click `[[Some page]]` in a static block                       | `@seqno/web`    | `flows/import.e2e.ts` › a page link opens the page | passing |
| Create a page from a link                       | 1     | type `[[New page]]`, leave the block, click the link          | `@seqno/graph`  | `flows/pages.e2e.ts`                               | planned |
| Rename a page (links update)                    | 2     | click the page title, edit it                                 | `@seqno/graph`  | `flows/pages.e2e.ts`                               | planned |
| Delete a page                                   | 2     | page menu › Delete page                                       | `@seqno/graph`  | `flows/pages.e2e.ts`                               | planned |
| Linked references at the bottom of a page       | 2     | open any page that others link to                             | `@seqno/index`  | `flows/references.e2e.ts`                          | planned |
| Unlinked references                             | 2     | expand "Unlinked references" under a page                     | `@seqno/index`  | `flows/references.e2e.ts`                          | planned |
| Block refs `((id))` render the referenced block | 2     | right-click a bullet › Copy block ref, paste in another block | `@seqno/editor` | `flows/references.e2e.ts`                          | planned |
| Block and page embeds `{{embed ...}}`           | 2     | type `{{embed [[page]]}}`                                     | `@seqno/editor` | `flows/references.e2e.ts`                          | planned |

## Search and queries

| Feature                                          | Phase | How to reach it                                           | Owner          | Flow                                                   | Status  |
| ------------------------------------------------ | ----- | --------------------------------------------------------- | -------------- | ------------------------------------------------------ | ------- |
| Full-text search across pages and blocks         | 2     | Search in the left sidebar, type (Mod+K is not wired yet) | `@seqno/index` | `flows/import.e2e.ts` › search finds an imported block | passing |
| Logseq-style query renders live results          | 2     | type `{{query (and [[project]] (task TODO))}}`            | `@seqno/query` | `flows/queries.e2e.ts`                                 | planned |
| Dataview-style query                             | 2     | type a Dataview-style query block                         | `@seqno/query` | `flows/queries.e2e.ts`                                 | planned |
| Query results update when matching blocks change | 2     | edit a block a visible query matches                      | `@seqno/index` | `flows/queries.e2e.ts`                                 | planned |

## Folders, import and sync

| Feature                                                                | Phase | How to reach it                                                                                 | Owner            | Flow                                                                                                | Status  |
| ---------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- | ------- |
| Keep the graph in a folder you pick (for example iCloud Drive › seqno) | 2     | graph menu › Open folder                                                                        | `@seqno/vault`   | `flows/folders.e2e.ts`                                                                              | planned |
| Reopen the picked folder after a reload                                | 2     | reload; allow access when Chrome asks                                                           | `@seqno/vault`   | `flows/folders.e2e.ts`                                                                              | planned |
| Import a Logseq graph                                                  | 2     | open a Logseq folder (or the demo graph) that has no edit log yet; it is imported on first open | `@seqno/interop` | `flows/import.e2e.ts` › an imported journal renders, an edit to an imported block survives a reload | passing |
| Markdown mirror (readable `.md` files next to the edit log)            | 2     | graph settings › Markdown mirror                                                                | `@seqno/interop` | `flows/import.e2e.ts`                                                                               | planned |
| Edits from another device show up                                      | 2     | another device writes to the shared folder                                                      | `@seqno/vault`   | `flows/sync.e2e.ts`                                                                                 | planned |
| A 50k-block graph opens on the first page quickly                      | 2     | open the 50k fixture                                                                            | `@seqno/graph`   | `flows/large-graph.e2e.ts`                                                                          | planned |

## How flows find things

Flows use roles, not CSS classes, so the same hooks serve screen readers. `src/test.ts` keeps them in one place; when the UI picks different markup, change it there.

| Thing                   | Markup the flows expect                                                       | Locator                                              |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| A page (journal or not) | `<article>` labelled by its `<h1>` title                                      | `getByRole("article", { name: title, exact: true })` |
| A block                 | `role="treeitem"` inside `role="tree"`, with `aria-level` and `aria-expanded` | `getByRole("treeitem")`                              |
| The editor              | CodeMirror's `.cm-content`, which already has `role="textbox"`                | `getByRole("treeitem").getByRole("textbox")`         |

## Test data

- `seedOpfs(page, dir, path)` copies a folder byte for byte into the app origin's OPFS at `path`, before the app loads.
- `loadGraphFolder(page, dir)` seeds a folder and makes `window.showDirectoryPicker()` return it, so "pick a folder" flows (open a vault folder, import a Logseq graph) run headless.
- `fixtureGraph(name)` resolves `fixtures/<name>`.
- `opfsFiles(page, path)` reads an OPFS folder back as `{ "relative/path": bytes }`.
- `seedOpfs` navigates the page it is given. To drop files in while the app is open (another device syncing), pass it a second page from the same context: `await seedOpfs(await page.context().newPage(), dir, path)`. Pages in one context share OPFS.
