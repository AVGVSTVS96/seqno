# @seqno/outliner

The block tree view on the UI side: it renders a page's blocks with the same parser the core uses and handles bullets, collapse, zoom, selection, keyboard moves, drag and drop, and virtualization.

## What's inside

| Export                                                                                   | What it does                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Outliner`                                                                               | `<Outliner pageId zoom onNavigate editor? embedded? addable? windowed? resolveAsset? onBlockMenu?>`. Reads `WatchPage`, writes `Dispatch` and `DispatchAll`.                                                          |
| `EditorSlotProps`, `EditorIntent`                                                        | The slot the app fills with a block editor, and the intents it sends back (split, merge, indent, focus, select, move, collapse).                                                                                      |
| `PlainTextEditor`                                                                        | The textarea editor used when no `editor` is passed.                                                                                                                                                                  |
| `coreLayer`, `coreRuntime`                                                               | Set `coreLayer` in the atom registry to give the outliner its `CoreClient`.                                                                                                                                           |
| `pageTreeAtom`, `blockAtom`, `dispatchAtom`, `historyAtom`, `editRequest`, `pageListKey` | Atoms the app shares with the outliner.                                                                                                                                                                               |
| `historyStep`, `clickOnEnter`                                                            | Small helpers: undo/redo key matching, and Enter-to-click on focusable links.                                                                                                                                         |
| `ScrollContent`, `useVirtualList`, `NestedLists`                                         | Windowing for any long list, on TanStack Virtual: `ScrollContent` goes inside a scroll element, and a list under it mounts only the items near the screen. A list whose items hold lists wraps them in `NestedLists`. |
| `placeOf`, `restorePlace`                                                                | Where a scroller is, as the row at the top of the screen and its distance from the top, and putting that row back there until the user scrolls, clicks, types or moves focus. Back uses them.                         |

- Block content: tasks, priorities, properties, SCHEDULED / DEADLINE, logbook, page and block refs, embeds, live query panels, code blocks, quotes, headings, images, videos.
- `{{video url}}` (also `{{youtube url}}`, `{{vimeo url}}`): YouTube waits as a thumbnail and becomes a `youtube-nocookie.com` player on click, Vimeo loads lazily, and a direct `.mp4`/`.webm` plays in a `<video>`. `{{youtube-timestamp 1:30}}` seeks the nearest video before it on the same page, or starts it there.
- Hovering a ref shows a preview of the page or block.
- A `windowed` outliner under `ScrollContent` mounts only the rows near the screen, with spacers for the rest. TanStack Virtual measures the mounted rows, and a list moves the scroll position by the same amount when a row that was wholly above the top of the screen changes height, scrolling up or down. Where the row was comes from the list's layout as last rendered, placed where the list is on the screen now. An outline that loads again keeps the height it last had until its rows are back, and a list reserves its remembered height (or its rows' estimates) until it knows where it starts. The rows, list numbers and height estimates of a page are worked out once per page version (`layOut`), so scrolling a 30k-block page only places the rows on screen. The journals and All pages window with the same `useVirtualList`.
- Lists can nest: the journals are a list of days, and each day's outline is a list of rows on the same scroller. A row of a day and the day itself are seen by two lists, so each change is judged by whichever sees it first: the outer list goes first in a ResizeObserver pass and notes its verdict on each day, which the nested list follows; a nested list that measures a new row during React's commit judges it itself and notes how much of its day it handled, which the outer list leaves alone. Corrections add to the scroll position instead of setting it, so two lists correcting in one frame don't undo each other. A list mounts no items until it knows where it starts, and nested lists remember their measured heights apart from top-level ones, so flinging through the journals doesn't push out a long page's heights.

## Tests

Browser-mode Vitest in headless Google Chrome, so it has to be installed.

```sh
pnpm test --project @seqno/outliner
```

## Known gaps

- An outline that isn't `windowed` renders all its rows: an embed's and a reference's.
- A picture that loads while it's on screen, or in the row the top of the screen cuts through, pushes the rows below it down: its size isn't known until it loads.
- Code highlighting covers JavaScript, TypeScript, JSX, CSS, HTML and Python; other languages render plain.
- There is no toolbar for a multi-block selection, which Logseq 2.x has.
