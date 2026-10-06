# @seqno/outliner results (phase 1)

## What works

```
<Outliner pageId zoom onNavigate editor?>
  reads   pageTreeAtom(pageId)   WatchPage stream    (via coreRuntime + CoreClient)
  writes  dispatchAtom(command)  Dispatch rpc        (concurrent, so fast typing never cancels an edit)

  breadcrumbs (when zoomed)
  tree container (scrolls, role=tree)
    canvas, height = sum of row heights
      row  absolute top = running sum of measured heights, left padding = depth * 24px
           guides | toggle | bullet (zoom, drag handle) | StaticBlock or <Editor/>
```

- **Flat, absolutely positioned, virtualized rows** (the em LayoutTree idea). The page tree is flattened into rows with a depth; each row is keyed by block id, so Indent and Outdent only change `paddingLeft` and the focused editor stays mounted. Row heights are measured by one shared `ResizeObserver` through a ref callback. Only rows within 600px of the viewport (plus the editing row) are in the DOM: 2,000 blocks render under 80 rows.
- **Bullets, indentation guides, collapse/expand** (`SetCollapsed`), folded bullets get a ring.
- **Zoom with breadcrumbs.** `zoom` is a prop so the router owns it. The zoomed block shows as the first row, always expanded. Bullets and breadcrumbs call `onNavigate({ _tag: "Zoom", pageId, blockId })`.
- **Keyboard while editing** (the editor reports intents, the outliner turns them into commands):
  - Enter: `SplitBlock` at the caret, then the editor moves to the new block (found in the returned `BlockUpserted` events). Enter on an empty last child: `Outdent` (Logseq behavior).
  - Backspace at start: `MergeWithPrevious`, editor moves to the previous block at its old end.
  - Tab / Shift-Tab: `Indent` / `Outdent`. Up / Down on the first / last line: previous / next block. Escape: block selection.
- **Block selection mode**: Up/Down move, Shift extends, Shift-click extends, Tab/Shift-Tab indent/outdent the top-level selected blocks, Backspace/Delete `DeleteBlocks`, Mod-Up/Down collapse/expand, Enter edits.
- **Drag and drop** with native HTML5 drag on the bullet (drags the selection when the bullet is part of it). Drop zones: top half = before, bottom half = after, bottom half and right of the bullet = first child. Dropping onto itself or a descendant is refused. Emits `MoveBlocks`. A drop line shows where it lands.
- **Static markdown**: `[[page]]`, `#tag`, `#[[multi word]]`, `((block ref))` (rendered from `GetBlock`, clickable), `**bold**`, `*italic*`, `_italic_`, `~~strike~~`, `==highlight==`, `` `code` ``, `[label](url)`, bare URLs, headings, task markers, `key:: value` property lines, `SCHEDULED/DEADLINE`, fenced code blocks.
- **Editor slot**: `editor?: ComponentType<EditorSlotProps>`. `@seqno/editor` fills it. `PlainTextEditor` (a textarea) is the default and the reference implementation of the slot contract.
- Styles ship with the component through React 19 `<style href precedence>`, so there is no CSS import for the app to remember.

## How to run its tests

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm --filter @seqno/outliner exec vitest run
```

13 Vitest browser-mode tests (headless Chrome through Playwright, `channel: "chrome"`, React Compiler on). They render `<Outliner>` against an in-memory core built with `RpcTest.makeClient(CoreRpcs)` (`test/fake-core.ts`), drive it with real clicks, keys and drags, and compare the dispatched commands and the rendered rows against literal values. `pnpm check` from the root passes; the whole test run peaks at about 1.2 GB, close to the 1.5 GB scope.

## For integration

- **`CoreClient` now lives in `@seqno/rpc`** (moved at integration). The app sets `coreRuntime.layer` to its worker client layer in `RegistryProvider` `initialValues`.
- **New contract types** (all in this package):
  - `EditorSlotProps { block, caret, dispatch, onIntent }` and `EditorIntent` (`Split { at } | MergeWithPrevious | Indent | Outdent | FocusPrevious | FocusNext | Exit`), a `Schema.TaggedUnion`.
  - `NavigationTarget`: `Page { name } | Zoom { pageId, blockId | null }`. The app maps these to routes.
- **Assumption about `PageTree.blocks`**: sibling order is the order blocks appear in the array (pre-order works). The graph must emit blocks in tree order.
- React is **19.3.0**, aligned with the app at integration. `@effect/atom-react` 4.0.1 gets its own `scheduler` 0.27.0 peer.
- `pnpm install` added `minimumReleaseAgeExclude: [vite@8.3.3]` to `pnpm-workspace.yaml`: Vitest's browser provider peers resolve the newest Vite for the other workspace packages. I pinned the outliner's own Vite to 8.3.2.

## Known gaps

- `PlainTextEditor` is uncontrolled: a remote edit to the block you are typing in does not show until you leave it. CodeMirror in `@seqno/editor` is the real fix.
- Clicking a block puts the caret at the end, not where you clicked (rendered text and source offsets differ).
- Block refs come from `GetBlock` once and do not live-update; they should read the page tree or a watch when the ref is on another page.
- Row heights start as a 30px estimate and settle after the first `ResizeObserver` pass, so a very tall block can shift rows by one frame on first show.
- No keyboard move (Alt-Shift-Up/Down), no drop onto another page, no drag auto-scroll, no Undo/Redo keys (the app shell should bind those globally).
- The fake core in the tests applies only `EditText`, `SplitBlock`, `SetCollapsed` and a simple `Indent`; the rest are only recorded.
