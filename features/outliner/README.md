# @seqno/outliner

The block tree view on the UI side: it renders a page's blocks with the same parser the core uses and handles bullets, collapse, zoom, selection, keyboard moves, drag and drop, and virtualization.

## What's inside

| Export                                                                                   | What it does                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Outliner`                                                                               | `<Outliner pageId zoom onNavigate editor? embedded? addable? resolveAsset? onBlockMenu?>`. Reads `WatchPage`, writes `Dispatch` and `DispatchAll`. |
| `EditorSlotProps`, `EditorIntent`                                                        | The slot the app fills with a block editor, and the intents it sends back (split, merge, indent, focus, select, move, collapse).                   |
| `PlainTextEditor`                                                                        | The textarea editor used when no `editor` is passed.                                                                                               |
| `coreLayer`, `coreRuntime`                                                               | Set `coreLayer` in the atom registry to give the outliner its `CoreClient`.                                                                        |
| `pageTreeAtom`, `blockAtom`, `dispatchAtom`, `historyAtom`, `editRequest`, `pageListKey` | Atoms the app shares with the outliner.                                                                                                            |
| `historyStep`, `clickOnEnter`                                                            | Small helpers: undo/redo key matching, and Enter-to-click on focusable links.                                                                      |

- Block content: tasks, priorities, properties, SCHEDULED / DEADLINE, logbook, page and block refs, embeds, live query panels, code blocks, quotes, headings, images, videos.
- `{{video url}}` (also `{{youtube url}}`, `{{vimeo url}}`): YouTube waits as a thumbnail and becomes a `youtube-nocookie.com` player on click, Vimeo loads lazily, and a direct `.mp4`/`.webm` plays in a `<video>`. `{{youtube-timestamp 1:30}}` seeks the nearest video before it on the same page, or starts it there.
- Hovering a ref shows a preview of the page or block.
- Only rows near the viewport are mounted. Spacers above and below are watched by an `IntersectionObserver`, and row heights are measured with a `ResizeObserver`.

## Tests

Browser-mode Vitest in headless Google Chrome, so it has to be installed.

```sh
pnpm test --project @seqno/outliner
```

## Known gaps

- Code highlighting covers JavaScript, TypeScript, JSX, CSS, HTML and Python; other languages render plain.
- There is no toolbar for a multi-block selection, which Logseq 2.x has.
