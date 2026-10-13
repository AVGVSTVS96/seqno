# @seqno/bench

A tool: the benchmarks that CI runs on every push. Each fails when a budgeted number goes over.

## Open and type, in Node

```sh
pnpm --filter @seqno/bench bench
```

It generates the seeded 50k-block graph from `@seqno/fixtures`, imports it, and takes a snapshot. The bulk commands run on their own graph, the 20k-block page the Chrome benchmark scrolls, opened fresh for each, once in each layout. Then:

| Number                                               | Budget | How                                                                                                                                                                                              |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open: page list and first page (median)              | 1 s    | `restore` the snapshot into an empty graph, list the pages, read a journal.                                                                                                                      |
| Open through the vault (median)                      | 1 s    | A folder holding the snapshot and its writer's `seen` file: `vault.sync` into an empty graph, then the page list and a journal.                                                                  |
| Keystroke: edit and index write (p95)                | 16 ms  | 300 `EditText` commands, each followed by its index write.                                                                                                                                       |
| Undo after 1k edits from another device              | 16 ms  | Type into 5 blocks (10 steps), merge 1,000 edits from a second graph, undo all 10; the slowest.                                                                                                  |
| Delete 5,000 of a 20k-block page                     | 2 s    | Select 5,000 blocks in page order from a quarter of the way down and delete them.                                                                                                                |
| Undo that delete                                     | 2 s    | Undo it.                                                                                                                                                                                         |
| Move 5,000 of a 20k-block page                       | 2 s    | Move the same selection to the top of the page.                                                                                                                                                  |
| Indent 5,000 of a 20k-block page                     | 2 s    | Indent 5,000 top-level blocks, from the second one down.                                                                                                                                         |
| The same four, a tree per page                       | 2 s    | The same page and commands on `graphV2Layer`.                                                                                                                                                    |
| Import and seed                                      | -      | Reported only.                                                                                                                                                                                   |
| Index fill behind the open                           | -      | Reported only.                                                                                                                                                                                   |
| Index: load the saved image and catch up (median)    | 100 ms | The image saved after the fill, loaded into a new index, caught up on the pages the 300 keystrokes changed.                                                                                      |
| Ten years, a tree per page: open (median)            | 300 ms | Ten years of journals and a 20k-block page written in the tree-per-page layout, then opened three times in a fresh `node` process: `restore` the snapshot, list the pages, read today's journal. |
| Ten years, a tree per page: a block on the long page | 2 s    | Then, in each of those opens, the long page's last block by its id and page: what a search hit costs on a page not read yet.                                                                     |
| Ten years, a tree per page: write them               | -      | Reported only.                                                                                                                                                                                   |

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

`open.bench.ts`, in the same `scroll` run, writes the same ten years of journals with the `seen` file of the device that wrote the snapshot (the long page loads last, so the fill writes it last), opens the folder, jumps to the middle, a quarter and three quarters of the journals while the first fill runs, and waits until All pages lists `quillwort`, a name only the long page's last block links to, which ends the fill. All pages reads that from the index alone. Then it reloads the tab while the index save after the fill writes. The worker is a `SharedWorker` with `extendedLifetime`, so it outlives the tab long enough to finish that save, and the reloaded tab reopens the graph from it instead of filling again. Once the reopened index has the long page's last block, it searches for that block, which the graph hasn't read yet. Last, it opens the same years again under another folder name, reloads once half the final index is on disk, and times the rest of that fill, which must take less than a whole fill.

| Number                                           | Budget                 |
| ------------------------------------------------ | ---------------------- |
| Open: first journal on screen                    | 5 s                    |
| Open: rows after a jump during the fill, slowest | 1.5 s                  |
| Reopen: first journal on screen                  | 5 s                    |
| Reopen: the index file the closed tab saved      | > 0 MB                 |
| Reopen: the index has the long page's last block | 4 s                    |
| Reopen: then search shows that block             | 2 s                    |
| Second fill: the rest, after a mid-fill reload   | less than a whole fill |
| Fill time                                        | -                      |

On cloud (headless Chrome 154) the first open shows a journal in about 3 s and fills the index in 72 to 82 s; a reload while the save writes finds the 67 MB file on disk and shows a journal in 3.4 s. On a CI runner the reopen shows a journal in about 2 s and All pages lists `quillwort` 0.1 to 0.2 s later, 1.8 to 2.2 s after the reload; before All pages mounted only the rows near the screen, rendering all 6,654 of them took that to 4.8 to 5.5 s. Search after the reopen then shows the long page's last block in about 0.8 s; before the graph looked blocks up on the page the index has them on, it waited about 33 s for the graph's walk of every page. Without `extendedLifetime` the reload ended the worker mid-write, left no file, and the reopen filled from scratch. In Node, the vault open takes about 0.4 s and loading the image and catching up 7 ms, against 6 s for the fill.

`SEQNO_BENCH_FOLDER` opens a folder already written with `write-years.ts` instead of writing one.

`SEQNO_BENCH_YEARS` and `SEQNO_BENCH_LONG_PAGE` change the graph's size. `node src/write-years.ts <folder> <years> <long page blocks>` writes the same graph as a folder to open by hand.

## Known gaps

- The Node benchmark leaves out reading files from OPFS or a picked folder and the trip between the worker and the tab; the Chrome one covers them.
- CI runners vary in speed, so a run near a budget can fail on a slow runner.
