# @seqno/editor

The UI-side editor for the one block being edited: a CodeMirror 6 view in the block's own box, with Logseq's keys, auto-pairs, `[[` `((` `#` `/` popups and a date picker.

## What's inside

| Export                                          | What it does                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `BlockEditor`                                   | React component: `<BlockEditor block cursor updates host handoff properties? hidden? />`.                                            |
| `mountBlockEditor`                              | The same without React; returns `{ view, popups, destroy }`.                                                                         |
| `EditorHost`                                    | What the app provides: `dispatch(command)`, `act(action)`, `searchPages`, `searchBlocks`.                                            |
| `EditorAction`, `CursorPlacement`, `LinkTarget` | What the editor asks the app to do (focus, select, move, collapse, zoom, open a link), and where the caret lands.                    |
| `createHandoff`                                 | One per app. Holds keys typed right after Enter until the new block's editor mounts, and carries the caret's column between editors. |
| `editorBindings`                                | The editing shortcuts with labels, for the app's keymap list.                                                                        |

`updates` is a `Stream<Block>` of this block from the page tree. The editor applies text that comes back from the graph and skips echoes of its own typing.

## Tests

Vitest in jsdom.

```sh
pnpm test --project @seqno/editor
```

## Known gaps

- Edit offsets are relative to the editor's text and the core doesn't rebase them, so a remote edit landing mid-typing can misplace a few characters until the next update.
- If the core rejects a split, keys typed after Enter stay held until the next click.
- `[[` lists pages only; Logseq 2.x also lists matching blocks.
