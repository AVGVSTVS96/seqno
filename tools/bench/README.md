# @seqno/bench

A tool: the benchmarks that CI runs on every push. Each fails when a budgeted number goes over.

## Open and type, in Node

```sh
pnpm --filter @seqno/bench bench
```

It generates the seeded 50k-block graph from `@seqno/fixtures`, imports it, and takes a snapshot. Then:

| Number                                  | Budget | How                                                                         |
| --------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Open: page list and first page (median) | 1 s    | `restore` the snapshot into an empty graph, list the pages, read a journal. |
| Keystroke: edit and index write (p95)   | 16 ms  | 300 `EditText` commands, each followed by its index write.                  |
| Import and seed                         | -      | Reported only.                                                              |
| Index fill behind the open              | -      | Reported only.                                                              |

## Years of journals, in Chrome

```sh
pnpm --filter @seqno/bench scroll
```

It writes ten years of daily journals (3,653 journals and 3,001 other pages, 150k blocks, one of them a page of 20k blocks) as one snapshot, builds and previews `apps/web`, puts the snapshot behind the folder picker in headless Chrome, and opens it the way a person does. Scrolling moves the main view 60 px every frame for 600 frames, the way a fast trackpad flick does, and times the gap between frames.

| Number                                           | Budget  |
| ------------------------------------------------ | ------- |
| Open: click to the first journal on screen       | 10 s    |
| Journals: frame time p95, then 600 frames deeper | 33.4 ms |
| Long page: frame time p95                        | 33.4 ms |
| Journals: DOM nodes after scrolling              | 15,000  |
| Rows on screen after a jump to the middle        | 3 s     |
| Frames over 50 ms, page heap, Chrome memory      | -       |

At 60 Hz a frame is 16.7 ms, so a p95 of 33.4 ms allows one dropped frame in twenty. Chrome memory is the proportional set size of every Chrome process (Linux only).

`SEQNO_BENCH_YEARS` and `SEQNO_BENCH_LONG_PAGE` change the graph's size. `node src/write-years.ts <folder> <years> <long page blocks>` writes the same graph as a folder to open by hand.

## Known gaps

- The Node benchmark leaves out reading files from OPFS or a picked folder and the trip between the worker and the tab; the Chrome one covers them.
- CI runners vary in speed, so a run near a budget can fail on a slow runner.
