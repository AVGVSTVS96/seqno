# @seqno/editor results (phase 1)

The focused-block editor: one CodeMirror 6 view, mounted only on the block that has focus. Every change leaves as a `Command`; navigation leaves as a `Navigation` intent. The editor never owns block structure or undo history: the graph does.

## What works

```
 key / input                      what the host receives
 ───────────────────────────────  ─────────────────────────────────────────────
 typing, paste, completion        EditText { blockId, from, to, insert }  (one per changed range)
 Enter                            SplitBlock { at }   (deletes a selection first, as EditText)
 Enter inside an open ``` fence   EditText "\n"       (code blocks keep their newlines)
 Shift-Enter                      EditText "\n"       (soft line break)
 Backspace at offset 0            MergeWithPrevious
 Tab / Shift-Tab                  Indent / Outdent { blockIds: [blockId] }
 Mod-z / Mod-Shift-z, Mod-y       Undo / Redo         (no CodeMirror history; the graph owns undo)
 ArrowUp on first visual line     navigate ToPrevious { cursor: LastLine { column } }
 ArrowDown on last visual line    navigate ToNext     { cursor: FirstLine { column } }
 ArrowLeft at 0 / Right at end    navigate ToPrevious { End } / ToNext { Start }
```

- **Command mapping** (`src/edits.ts`): a multi-range transaction becomes EditTexts in descending order, so each one applies to the text the previous one left. Offsets are UTF-16 code units, matching the scaffold note.
- **Cursor placement**: the outliner passes a navigation's `cursor` straight into the next editor's `cursor` option. `CursorPlacement` is `Start | End | Offset | FirstLine | LastLine`, clamped to the text.
- **Live markdown** (`src/markdown.ts`): `@lezer/markdown` (GFM base) plus inline parsers for `[[page]]`, `((block))`, `#tag`, `#[[two words]]`. Markers stay visible as `.sq-mark` (dimmed) next to `.sq-strong`, `.sq-page-ref`, `.sq-tag` and so on. Refs inside inline code stay code. `#` inside a word (`issue#4`) is not a tag.
- **Autocomplete** (`src/autocomplete.ts`): `[[`, `((` and `#` call the injected `searchPages` / `searchBlocks`. They return Effects; CodeMirror's abort interrupts the running fiber. Accepting reuses brackets that were auto-closed (`[[proj|]]` becomes `[[Project X]]`). A block ref inserts the block id. A tag with spaces becomes `#[[...]]`.
- **Text from the graph**: `textUpdates` is a `Stream<string>` of the block's text (for example, `WatchPage` mapped to this block). Echoes of the editor's own edits are dropped, even stale ones that arrive after more typing. Real outside changes (undo, redo, sync) go in as a minimal diff and are not dispatched again.
- **React**: `<BlockEditor key={blockId} ... />` mounts in a React 19 ref callback that returns its cleanup. No effect hooks. Re-renders do not remount it.

## API

```ts
import { BlockEditor, mountBlockEditor, type EditorHost } from "@seqno/editor"

const host: EditorHost = {
  dispatch: (command) => ...,            // Command -> core (RPC Dispatch); keep call order
  navigate: (navigation) => ...,         // move focus, pass navigation.cursor to the next editor
  searchPages: (query) => Effect<ReadonlyArray<Page>>,
  searchBlocks: (query) => Effect<ReadonlyArray<Block>>,
}

<BlockEditor key={block.id} blockId={block.id} text={block.text}
  cursor={{ _tag: "End" }} textUpdates={textOf(block.id)} host={host} />
```

`mountBlockEditor(parent, options)` is the same thing without React. It returns `{ view, destroy }`.

## How to run the tests

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm exec vitest run --project @seqno/editor
```

Tests run in jsdom (26 tests). They press real key events through `runScopeHandlers` and compare the dispatched commands, navigations, doc text, caret and styled spans against literal values. `test/setup.ts` stubs `Range.getClientRects`, which jsdom lacks. Because jsdom has no layout, "visual line" falls back to the document line in tests.

## Additions to the contract (for integration to reconcile)

- `CursorPlacement`, `Navigation`, `EditorHost` and `BlockEditorOptions` live in this package (`src/host.ts`). The outliner needs `Navigation` and `CursorPlacement`. If other packages need them too, they can move to `@seqno/domain`.
- Search needs a core endpoint. `@seqno/rpc` has no page or block search RPC yet, so `searchPages` / `searchBlocks` are injected. The host should supply them from a future `SearchPages` / `SearchBlocks` RPC (FTS in `@seqno/index`).

## Known gaps

- **Wrapped lines in a real browser**: the edge check uses `moveToLineBoundary(..., includeWrap)`, which measures wrapped lines with real layout. Only the document-line fallback is unit-tested. The Playwright harness should cover ArrowUp/ArrowDown on a wrapped block.
- **Delete at end of block** (merge the next block into this one) has no command in the contract (`MergeWithNext`), so it is not bound.
- **Escape** (leave editing, select the block) is not bound yet. It needs a third `Navigation` case agreed with the outliner.
- **Concurrent remote edits while typing**: EditText offsets are relative to the editor's text. If another device's change lands in the core between keystrokes, later offsets can be off until the next text update resyncs the editor. Fixing this needs the core to rebase offsets, or the editor to send a base version.
- **Ordering**: `dispatch` is fire-and-forget. The host must send commands in call order (one RPC queue).
- **Styling extras**: `TODO`/`DONE` markers, `key:: value` properties, `^^highlight^^` and `{{query}}` macros are not styled yet. Nested page refs (`[[a [[b]]]]`) are not parsed.
- Host callbacks are read once at mount, so they must be stable (atom setters are).
