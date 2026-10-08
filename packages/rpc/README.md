# @seqno/rpc

The contract between the UI side and the core worker, written as Effect RPC groups that import only `@seqno/domain`.

## What's inside

| Export                                                                                                                | What it is                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CoreRpcs`                                                                                                            | `OpenGraph`, `Dispatch`, `GetPages`, `GetPage`, `GetBlock`, `Search`, and the live streams `WatchPage`, `WatchQuery`, `WatchBlockRefCounts`, `WatchBlockReferences`. |
| `PageRpcs`                                                                                                            | What a page view needs: `WatchReferences`, `WatchNameReferences`, `WatchUnlinkedReferences`, `WatchPageStats`, `WatchReferencedPages`, `Ancestors`.                  |
| `CoreClient`, `PageClient`                                                                                            | Effect services holding a typed client for each group.                                                                                                               |
| `PageTree`, `GraphOpened`, `QueryResult`, `SearchHits`                                                                | Result Schemas. A `PageTree` is a page plus its blocks in depth-first order.                                                                                         |
| `Reference`, `PageStat`, `ReferencedPage`                                                                             | Result Schemas for references, page stats and pages that exist only as references.                                                                                   |
| `GraphNotOpen`, `GraphUnavailable`, `GraphLocked`, `PageNotFound`, `BlockNotFound`, `CommandRejected`, `QueryInvalid` | Tagged errors that cross the worker boundary.                                                                                                                        |

- The UI side talks to the core only through these groups.
- `PageRpcs` is its own group, so test cores that implement only `CoreRpcs` keep compiling. The web worker serves `CoreRpcs.merge(PageRpcs)`.
- `OpenGraph` takes `wait?` and fails with `GraphLocked` while another tab holds the graph.

## Tests

```sh
pnpm test --project @seqno/rpc
```
