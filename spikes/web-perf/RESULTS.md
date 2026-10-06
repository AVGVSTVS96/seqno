# web-perf: Loro 1.16.2 (WASM) in a Chrome worker, 50k-block graph

**Preliminary.** These numbers come from a shared Linux box (Ryzen 7 5700G, load avg ~1 from other agents), headless Chrome 153.0.8010.52, loro-crdt 1.16.2, sqlite-wasm 3.53.4-build2. Raw output is in `results.linux.json`.

## Bars

| bar | target | measured (median of 5 cold workers) | |
|---|---|---|---|
| open: snapshot → full block map | ≤ 1 s | **1.19 s** | FAIL |
| open: snapshot + 200 update files → full block map | ≤ 1 s | **1.32–1.41 s** (3 runs) | FAIL |
| keystroke p95, main → worker → main | ≤ 16 ms | **0.16 ms** | pass |
| merge 1k remote edits → block map | ≤ 50 ms | **44–49 ms** median over 3 runs (single merges 42–56 ms) | pass, barely |
| memory: worker JS + WASM + main JS | ≤ 150 MB | **133 MB** | pass |

Every run checks state against the fixture model. The event-driven block map matched the expected digest after open, after the merge, and after 10k edits. After the keystrokes and moves it also matched a fresh rebuild from Loro.

**Verdict:** editing is fine. Keystrokes and moves come in about 100x under the frame budget. Opening fails: building a full in-memory block map takes 1.2–1.4 s. Merge passes, but with very little room.

## Where open time goes

```
                               import    block map    open      WASM
snapshot only                   16 ms    1,178 ms   1,193 ms    88 MB
snapshot, then each update     271 ms    1,136 ms   1,406 ms   121 MB   <- path used for the session
importBatch([snapshot, 200])  1,003 ms     521 ms   1,523 ms   334 MB
first page only                344 ms  + 17 ms page list + 26 ms for 1,088 blocks = 388 ms, 82 MB
```

- **Import is cheap; reading everything out is not.** Loro loads a snapshot lazily (16 ms). Almost all of the open time is `tree.toJSON()` reading 52k nodes, each with a map and a LoroText. The CPU profile shows the time is mostly inside wasm; about 0.2 s goes to JS string conversion. I tried other ways to read in bulk in node (`getShallowValue` plus a `toJSON` per map, and `getNodes` plus per-node reads). They were the same speed or slower.
- **Lazy state stays slow.** A second full read still takes about 1.2 s. Merge into a lazy doc takes 42–56 ms, compared with 20–23 ms into a doc whose state is fully built (both shown in `merge` in the JSON). I confirmed the 2x difference in node with alternating runs.
- **The import order matters a lot:**
  - `importBatch([snapshot, ...updates])` builds the full state. Reads and merges get faster, but WASM grows to 334 MB, which fails the memory bar.
  - `import(snapshot)` followed by `importBatch(updates)` uses 179 MB.
  - `import(snapshot)` followed by importing the updates one at a time uses 82 MB and is the fastest.
- These open numbers start from bytes already in memory. Not included: wasm init (about 20 ms), fetching from localhost (70 ms for the snapshot, 270–320 ms with the 200 files), and worker spawn. From spawn to a built block map is 1.33 s (snapshot only) and 1.79 s (with updates).

## Other numbers (final run)

- **Keystroke** (2,000 inserts into random blocks: insert, commit, sync event → block map): inside the worker p50/p95/p99 is 0.09/0.115/0.145 ms. Round trip from the main thread is 0.12/0.155/0.195 ms. The worst single keystroke was 0.72 ms.
- **Subtree move** (500 moves to a new parent; subtrees average 4.9 blocks, max 32): p95 is 0.055 ms in the worker and 0.08 ms round trip.
- **10k local edits** (55% insert text, 15% delete text, 12% create, 12% move, 6% delete): 0.86 s total, p95 0.115 ms per edit.
- **Batched save**: exporting an update every 25 edits takes p95 0.105 ms.
- **Memory**:
  - after open: 131 MB (WASM 121, worker JS heap 8.7, main JS heap 1.2)
  - after 10k edits: 133 MB
  - WASM memory never shrinks, so the high-water mark from open is what stays.
- **Sizes**:
  - snapshot: 17.1 MB at first, 18.0 MB after the session
  - shallow snapshot: 9.2 MB at first, 9.5 MB after
  - exporting a snapshot takes 0.27 s; exporting a shallow snapshot takes 1.97 s
  - update file per batched save: 428 B mean (1–30 edits per save, mostly typing; 200 files written by prep) and 866 B mean (25 mixed edits per save, written in the browser)
- **Merge input**: 1,000 fixture edits, which is 8,353 Loro ops and 30.5 KB. The mix is 526 text inserts, 180 text deletes, 130 creates, 107 moves and 57 deletes.
- **SQLite index** (informational: opfs-sahpool in the same worker, tables for blocks, refs and FTS5):
  - build: 0.94 s total (block inserts 0.51, refs 0.18, FTS rebuild 0.13, indexes + commit 0.11), plus 58 ms for sqlite init
  - database: 17.9 MB
  - backlinks of the busiest page: 2,922 rows in 5.6 ms
  - FTS match: 6.2 ms
  - The extra pages created from refs come from the random edits typing into `[[...]]` and `#tag` text.

## Rerun

```sh
cd ~/dev/seqno/spikes/web-perf && pnpm install --frozen-lockfile && node scripts/bench.ts > results.json
```

- A run takes about 90 s. JSON goes to stdout and progress to stderr. Optional arguments are `[seed=20261006] [blocks=50000]`.
- The first run writes the fixture to `.cache/` (about 10 s). Prep then checks its own Loro block map against the fixture model.
- It needs `google-chrome-stable` (Playwright `channel: "chrome"`, headless). Chrome uses a throwaway persistent profile in `/tmp`, so OPFS is on disk.
- Fixture tests: `cd ~/dev/seqno/spikes/shared/fixture && pnpm test`

How it runs:

- **Build and serve:** `vite build` (production), then `vite preview` serves it with COOP/COEP headers. That gives a 5 µs `performance.now()` instead of 100 µs. Fixture files are served from `/fixture`.
- **Cold opens:** each cold open is a fresh worker.
- **Session:** one long-lived worker runs the session: open, memory, 10k edits, memory, keystrokes, moves, consistency check, sizes, SQLite.
- **Memory:** CDP `HeapProfiler.collectGarbage` then `Runtime.getHeapUsage` on the worker and on the page, plus `memory.buffer.byteLength` for WASM.

## Files

- `../shared/fixture/`: seeded fixture generator, plain TypeScript with no platform APIs.
  - `generateGraph()`: 1,500 pages + 365 journals, 50k blocks, depth 1–10 (90%+ at depth 1–4), 10–300 chars. Content includes refs, tags, block refs, properties, task markers and SCHEDULED/DEADLINE lines.
  - `generateEdits()` / `applyEdits()`: a seeded stream of valid edits plus a reference model.
  - `graphDigest()`: compares state across platforms. Pinned values: graph `5405c909c0dd19e2`; 10k edits with seed 1 → `a9197d2c91dfba7c`.
- `scripts/prep.ts`: writes the snapshot, 200 update files from 2 peers, the 1k-edit merge from a third peer, the 10k local edit stream and the expected digests.
- `scripts/bench.ts`: the single command (prep → build → preview → Chrome → JSON).
- `src/schema.ts`: Loro tree with a map per node and the block text as a LoroText; event-driven block map.
- `src/worker.ts`, `src/main.ts`: Loro and SQLite in the worker; the main thread drives the run and times the round trips.
- `src/sqlite.ts`: builds the index.

## Blocked

Nothing. The open bar needs a decision (below), not new access.

## Decisions for you

1. **Open bar.** Loro can't produce a full JS block map for 50k blocks in under 1 s. Options:
   - **(a)** Don't build the full map at open. Load the page list plus the visible page (388 ms measured for a 1,088-block page) and fill in the rest in the background.
   - **(b)** Persist a block-map cache (for example in the SQLite index, keyed by Loro version), open from it, and apply only newer updates. This changes the architecture.
   - **(c)** Raise the bar to about 1.5 s for 50k blocks.

   I recommend (a): it fits Loro's lazy loading and keeps memory at about 82–121 MB.
2. **Merge margin.** 44–49 ms against a 50 ms bar is fragile on the lazy path. A fully built state merges in about 21 ms but costs 334 MB. Options:
   - accept it, since merges run off the main thread and don't block the UI;
   - set the bar at 100 ms;
   - look into building state for recently used pages only.
