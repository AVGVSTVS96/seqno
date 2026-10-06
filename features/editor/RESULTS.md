# @seqno/editor results (Logseq look-alike pass)

The focused-block editor: one CodeMirror 6 view, mounted only on the block being edited. It now looks and behaves like Logseq's editing state, draws Logseq's `[[`, `((`, `#` and `/` popups, and fixes the three feel problems from phase 1 (keys lost after Enter, caret jumping on Up/Down, missing shortcuts).

```
 outliner row ── <EditorSlot> (apps/web) ── <BlockEditor>
                                              │
        CodeMirror view in the block's box ───┤  keymap ─ autopair ─ completion (popup state, search)
        popup: CodeMirror tooltip in <body>,  │
        React portal draws the rows       ────┘  handoff (shared by every editor): held keys, carried caret
```

## What matches Logseq now

Measured with `getComputedStyle` / `getBoundingClientRect` on test.logseq.com (2.x) and demo.logseq.com (classic), then on seqno at 1440×900.

**Editing state** (SPEC "Block text", "Editing block")

| What                    | Logseq                                                                   | seqno                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Font, size, line height | text area at the block's Inter 16px / 24px, no padding, margin or border | CodeMirror inherits the block's font and line height, all padding removed: entering edit mode moved no glyph (measured 0px x and y) |
| Raw markdown            | plain text in the text color, brackets and markers visible               | same: no syntax colors at all                                                                                                       |
| Headings                | classic keeps `# x` blocks at heading size, weight and bottom rule       | `sq-h1`…`sq-h6` on the editor: 32/48, 24/36, 19.2/28.8 at 600, 4px / 3px rule like the rendered heading                             |
| Caret                   | 1px, text color                                                          | native caret, `--fg` (light `#171717`, dark `#a4b5b6`)                                                                              |
| Selection               | `--bg-text-selection` / `--fg-text-selection`                            | native selection through theme.css: `#e4f2ff` light, `#338fff` dark (measured)                                                      |
| Focus ring              | none                                                                     | none                                                                                                                                |

**Popups** (SPEC "Autocomplete popup", "Slash menu")

| What            | Logseq                                                                            | seqno                                                                               |
| --------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Anchor          | left = caret just after the trigger − 20px, top = caret line bottom + 3px         | same (measured 1059.9 → 1040, line bottom + 3.0); flips above the line when it must |
| Window edge     | right edge kept inside the window (512px popup clamped to x = 928)                | same (x = 928 in the `[[Gar` scene)                                                 |
| Frame           | `--bg-popover`, 1px `--border`, radius 6, padding 6, `--shadow-popover`           | same                                                                                |
| Width / height  | 512px for `[[ (( #`; 288px and at most 480px for `/`, scrollbar hidden            | same                                                                                |
| Rows            | 32px, padding 6 8, radius 4, 14/20, `--fg-popup`; chosen `--bg-popup-active`      | same; block rows 52px (72px when wrapped) with the 12px breadcrumb at 0.7           |
| Group headings  | 32px, padding 8, 12/16 500, `--fg-popup-group`, only when nothing is typed        | same                                                                                |
| Icons           | slash: 18px Tabler-style at 0.7, 1 when chosen; pages: 14px at 0.5 in a 20px box  | same sizes and opacities                                                            |
| Matches         | `<mark>` `#fef3ac` / `#262626`, no padding or radius                              | same                                                                                |
| Hover           | moving the pointer chooses the row; hovered text goes to `--fg-strong`            | same                                                                                |
| Enter animation | 150ms ease: opacity 0 → 1, scale 0.95 → 1, 8px slide                              | same (slides the other way when flipped above)                                      |
| Keys            | ↑ ↓ and Ctrl+P / Ctrl+N wrap around; Enter and Mod+Enter pick; Esc leaves editing | same                                                                                |
| Filtering `/`   | flat list: prefix matches (shortest first), then inside words, then scattered     | same ordering rule; a unit test replays Logseq's own `/to` and `/h` results         |
| `[[` rows       | pages, "New page X" second after a close match, first otherwise, gone on exact    | same; empty `[[` offers Today, Tomorrow, Yesterday                                  |

**Slash commands** (2.x groups and styling, markdown commands from classic):

| Group       | Commands                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| BASIC       | Page reference, Page embed, Block reference, Block embed (each opens its search)                                                    |
| FORMAT      | Link, Image link, Underline, Code block, Quote, Math block                                                                          |
| Heading     | Normal text, Heading 1 – 6                                                                                                          |
| TASK STATUS | TODO, DOING, LATER, NOW, DONE, WAITING, CANCELED                                                                                    |
| TASK DATE   | Deadline, Scheduled (today's date, `SCHEDULED: <2026-10-06 Tue>`)                                                                   |
| PRIORITY    | Priority A, B, C, No priority                                                                                                       |
| TIME & DATE | Tomorrow, Yesterday, Today (as `[[Oct 7th, 2026]]` refs), Current time                                                              |
| LIST TYPE   | Number list (`logseq.order-list-type:: number`)                                                                                     |
| ADVANCED    | Query, Advanced Query, Query function, Calculator, Embed HTML, Embed Video URL, Embed YouTube timestamp, Embed Twitter tweet, Cloze |

**Shortcuts while editing** (from Logseq's keymap):

| Keys                                 | What                                                          |
| ------------------------------------ | ------------------------------------------------------------- |
| Enter / Shift+Enter                  | new block / new line (Enter inside a ``` fence is a new line) |
| Tab / Shift+Tab                      | indent / outdent                                              |
| Backspace at start                   | merge into the block above                                    |
| Delete at end                        | merge the next block in                                       |
| ↑ ↓ on the first / last line         | previous / next block, same horizontal position               |
| ← → at the edges                     | previous block's end / next block's start                     |
| Shift+↑ / Shift+↓ past text          | select the block                                              |
| Esc                                  | leave editing, block selected                                 |
| Mod+Enter                            | TODO → DOING → DONE → none (LATER → NOW → DONE)               |
| Mod+B, Mod+I                         | `**bold**`, `*italic*` (wrap, unwrap, or an empty pair)       |
| Mod+Shift+H, Mod+Shift+S             | `==highlight==`, `~~strike~~`                                 |
| Mod+L                                | `[label]()` from the selection, `[](url)` for a URL           |
| Mod+↑ / Mod+↓, Mod+;                 | collapse / expand, toggle                                     |
| Alt+Shift+↑ / ↓                      | move the block among its siblings                             |
| Mod+Z, Mod+Shift+Z, Mod+Y            | undo, redo (the graph's history)                              |
| Mod+O, Mod+Shift+O                   | follow the link under the caret, or open it in the sidebar    |
| Alt+→ / Alt+← (Mod+. / Mod+, on Mac) | zoom into the block, zoom out one level                       |

Auto-pairs follow Logseq: `[ { ( `` ` `` ~`pair (no`(`right after a word),`* _ ^ = / +` only wrap a selection, typing a closer steps over it, Backspace between an empty pair deletes both.

## Feel fixes

- **Keys typed right after Enter land in the new block.** Enter starts a hold: a capture-phase `keydown` listener queues every key until the new block's editor mounts, then replays them there through the same keymaps and input handlers (so a replayed Enter or Tab works and holds again). When Enter outdents an empty last child instead, the block's parent change is the signal and the keys go back to the same editor. A click drops the queue. The split itself waits until the graph has echoed the block's typed text, so the outliner's "empty last child" rule never sees stale text. Proven by `flows/editor.e2e.ts` with `keyboard.type` and no waits; both flows fail with the hold switched off.
- **Up/Down keep the horizontal position.** The editor carries the caret's x (its goal column) to the next editor, which places the caret on its first or last visual line at that x and keeps it as its own goal column, so Up, Up, Down, Down returns to the exact same x. Logseq keeps the character column instead; x is the same thing for similar text and stays right across indentation and wrapped lines.
- **Backspace merge shows the result at once.** The previous block's editor opens with the merged text and the caret at the seam, and treats the graph's echo of the merge as its own.
- **Stale text from the graph is ignored.** A repeat of the text from before the typing reached the core no longer reverts what was typed (it used to, and could close an open popup). Undo and redo still take the graph's text.

## Tokens

No new tokens. Sizes that no token covers are literal and come from SPEC: popup widths 512px and 288px, slash height 480px, row height 32px, slash icon 18px, page icon 14px at 0.5, anchor offset −20px / +3px, the 3px heading-2 rule and the breadcrumb's 3px indent.

## Scenes compared

`editing`, `autocomplete` and `slash`, light and dark, both apps (`pnpm design editing autocomplete slash`), plus zoomed side-by-side strips of the whole slash menu and the `[[` popup taken with the probe in `tools/e2e/design-out/probe/`. The popups match row for row; the rest of each frame differs only where other parts (header, sidebar, bullets, titles) are still being rebuilt.

## What doesn't match yet

- **Icons**: Logseq draws several slash icons itself (node reference, node embed, task states, priority, tomorrow and yesterday, query). seqno uses the nearest Tabler icons and draws its own priority bars, so a few glyphs differ.
- **Exit animation**: Logseq fades the popup out over 150ms after a pick; seqno removes it at once.
- **Page search** ranks titles with substring and scattered-letter matching. Logseq 2.x's search is looser (it also lists blocks under `[[`, which a markdown graph can't reference that way).
- **Scheduled / Deadline** insert today's date; classic opens a date picker first. **Date picker**, **Number children**, **Template**, **Upload an asset** and **Add property** are not in the slash menu yet.
- **Shift+Enter in a popup** (open the chosen page in the sidebar) is not wired yet. Mod+O, Mod+Shift+O and Alt+→ / Alt+← landed at integration: the editor sends `Open` / `ZoomIn` / `ZoomOut` actions and the app's `EditorSlot` navigates.

## For the integration (other parts)

- `EditorSlotProps` on main has only Split, MergeWithPrevious, Indent, Outdent, FocusPrevious, FocusNext and Exit. `EditorSlot` does the rest itself with the slot's `dispatch`: MoveUp/MoveDown (`MoveBlocks` among siblings), Collapse/Expand/Toggle (`SetCollapsed`) and Delete-at-end (`MergeWithPrevious` on the next block). `ui/blocks` adds MoveUp, MoveDown, Collapse, Expand, SelectUp and SelectDown intents; once it lands, `EditorSlot`'s `act` can forward those instead (SelectUp/SelectDown map to Exit on main).
- Moving a block reorders rows; in `ui/blocks` (rows in normal flow) React moves the row's DOM node, which can blur the editor. The outliner should keep focus on the editing row when it moves.
- The outliner's Split handler decides "empty last child → outdent" from its tree. The editor now only sends Split once the tree has its text, so this stays correct, but the rule would be simpler if the intent carried the text.
- Pages that exist only as references (`#greenhouse`) are not in `GetPages`, so `[[` and `#` cannot suggest them.

## API

```ts
import { BlockEditor, createHandoff, EditorAction, type EditorHost } from "@seqno/editor"

const handoff = createHandoff()                     // one per app: holds keys, carries the caret between editors

const host: EditorHost = {
  dispatch: (command) => ...,                       // EditText, SplitBlock, MergeWithPrevious, Indent, Outdent, Undo, Redo
  act: (action) => ...,                             // EditorAction: FocusPrevious/Next, Exit, SelectUp/Down,
                                                    //   MoveUp/Down, Collapse, Expand, ToggleCollapse, MergeNext
  searchPages: (query) => Effect<ReadonlyArray<Page>>,           // the editor ranks them
  searchBlocks: (query) => Effect<ReadonlyArray<BlockHit>>,      // { block, path: breadcrumb titles }
}

<BlockEditor block={block} cursor={{ _tag: "Offset", offset }} updates={blockStream} host={host} handoff={handoff} />
```

`updates` is a `Stream<Block>` of this block from the page tree (text and parent). `mountBlockEditor(parent, options)` is the same without React and returns `{ view, popups, destroy }`; `popups` is the popup store the React wrapper renders from.

## How to run the tests

```sh
systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0 pnpm exec vitest run --project @seqno/editor
cd tools/e2e && systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0 \
  -E SEQNO_E2E_BASE_URL=http://localhost:4184/ pnpm exec playwright test flows/editor.e2e.ts
```

60 unit tests in jsdom (`test/editor.test.ts`, `test/popup.test.ts`, `test/BlockEditor.test.ts`, `test/format.test.ts`): keys go through `runScopeHandlers` and the input handlers, text from the graph through a `PubSub`, and the popup is checked both as state and as the rendered listbox. 8 e2e flows run on the real core.

## Known gaps

- **Concurrent remote edits while typing**: EditText offsets are relative to the editor's text, and the core does not rebase them. A change from another device that lands mid-typing can still misplace a few characters until the next update resyncs (event ordering is the hardening pass's).
- **A hold that never resolves**: if the core rejects a split, the held keys wait until the next click.
- Host callbacks are read once at mount; they must not depend on render-time state other than through atoms.
