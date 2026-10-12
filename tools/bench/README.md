# @seqno/bench

A tool: the benchmarks that CI runs on every push. Each fails when a budgeted number goes over.

## Open and type, in Node

```sh
pnpm --filter @seqno/bench bench
```

It generates the seeded 50k-block graph from `@seqno/fixtures`, imports it, and takes a snapshot. The bulk commands run on their own graph, the 20k-block page the Chrome benchmark scrolls, opened fresh for each. Then:

| Number                                            | Budget | How                                                                                                                             |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Open: page list and first page (median)           | 1 s    | `restore` the snapshot into an empty graph, list the pages, read a journal.                                                     |
| Open through the vault (median)                   | 1 s    | A folder holding the snapshot and its writer's `seen` file: `vault.sync` into an empty graph, then the page list and a journal. |
| Keystroke: edit and index write (p95)             | 16 ms  | 300 `EditText` commands, each followed by its index write.                                                                      |
| Undo after 1k edits from another device           | 16 ms  | Type into 5 blocks (10 steps), merge 1,000 edits from a second graph, undo all 10; the slowest.                                 |
| Delete 5,000 of a 20k-block page                  | 2 s    | Select 5,000 blocks in page order from a quarter of the way down and delete them.                                               |
| Undo that delete                                  | 2 s    | Undo it.                                                                                                                        |
| Move 5,000 of a 20k-block page                    | 2 s    | Move the same selection to the top of the page.                                                                                 |
| Indent 5,000 of a 20k-block page                  | 2 s    | Indent 5,000 top-level blocks, from the second one down.                                                                        |
| Import and seed                                   | -      | Reported only.                                                                                                                  |
| Index fill behind the open                        | -      | Reported only.                                                                                                                  |
| Index: load the saved image and catch up (median) | 100 ms | The image saved after the fill, loaded into a new index, caught up on the pages the 300 keystrokes changed.                     |

## Years of journals, in Chrome

```sh
pnpm --filter @seqno/bench scroll
```

It writes ten years of daily journals (3,653 journals and 3,001 other pages, 150k blocks, one of them a page of 20k blocks) as one snapshot with its writer's `seen` file, builds and previews `apps/web`, puts the snapshot behind the folder picker in headless Chrome, and opens it the way a person does. Scrolling moves the main view 60 px every frame for 600 frames, the way a fast trackpad flick does, and times the gap between frames.

| Number                                           | Budget  |
| ------------------------------------------------ | ------- |
| Open: click to the first journal on screen       | 5 s     |
| Journals: frame time p95, then 600 frames deeper | 33.4 ms |
| Long page: frame time p95                        | 33.4 ms |
| Journals: DOM nodes after scrolling              | 15,000  |
| Rows on screen after a jump to the middle        | 1.5 s   |
| Frames over 50 ms, page heap, Chrome memory      | -       |

On a CI runner it opens in about 2 s, scrolls both at a 16.7 ms p95, and keeps about 2,700 DOM nodes. At 60 Hz a frame is 16.7 ms, so a p95 of 33.4 ms allows one dropped frame in twenty. Chrome memory is the proportional set size of every Chrome process (Linux only).

## Opening and reopening years of journals, in Chrome

`open.bench.ts`, in the same `scroll` run, writes the same ten years of journals with the `seen` file of the device that wrote the snapshot, opens the folder, waits until search finds the last page the index fill writes, and until the index is saved. Then it reloads the tab, which reopens the graph from the saved index.

| Number                                | Budget |
| ------------------------------------- | ------ |
| Open: first journal on screen         | 5 s    |
| Reopen: first journal on screen       | 5 s    |
| Reopen: search finds the last page    | 5 s    |
| Fill time, save time, index file size | -      |

On a CI runner the first open shows a journal in about 1.9 s and fills the index in 55 s; the reopen shows a journal in 2.0 s and search finds the last page in 2.4 s. In Node, the vault open takes about 0.4 s and loading the image and catching up 7 ms, against 6 s for the fill.

`SEQNO_BENCH_FOLDER` opens a folder already written with `write-years.ts` instead of writing one.

`SEQNO_BENCH_YEARS` and `SEQNO_BENCH_LONG_PAGE` change the graph's size. `node src/write-years.ts <folder> <years> <long page blocks>` writes the same graph as a folder to open by hand.

## Known gaps

- The Node benchmark leaves out reading files from OPFS or a picked folder and the trip between the worker and the tab; the Chrome one covers them.
- CI runners vary in speed, so a run near a budget can fail on a slow runner.
