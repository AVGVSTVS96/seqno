# @seqno/bench

A tool: the 50k-block benchmark that CI runs on every push. It fails when a budgeted number goes over.

```sh
pnpm --filter @seqno/bench bench
```

It generates the seeded 50k-block graph from `@seqno/fixtures`, imports it, and takes a snapshot. Then, in Node:

| Number                                  | Budget | How                                                                         |
| --------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Open: page list and first page (median) | 1 s    | `restore` the snapshot into an empty graph, list the pages, read a journal. |
| Keystroke: edit and index write (p95)   | 16 ms  | 300 `EditText` commands, each followed by its index write.                  |
| Import and seed                         | -      | Reported only.                                                              |
| Index fill behind the open              | -      | Reported only.                                                              |

## Known gaps

- It runs in Node, not in a browser, so it leaves out reading files from OPFS or a picked folder and the trip between the worker and the tab.
- CI runners vary in speed, so a run near a budget can fail on a slow runner.
