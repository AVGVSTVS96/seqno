# sync-sim: does the iCloud edit-log layout converge with zero data loss?

**Short answer: yes.** 1,100 seeds of 5 devices running for 48 simulated hours against a hostile fake iCloud. Every device ended deep-equal, no op was lost, no file had two writers, and no placeholder was ever read as data. Two things make it work:

- the layout gains one small folder, `seen/<deviceId>.json`
- a device only deletes a file once a snapshot covering it is **confirmed**, meaning another device has downloaded and checksummed it. Without that step, 7 of 16 seeds briefly lost data on the server.

Simulated-time numbers (minutes to converge) don't depend on machine load. CPU and RSS numbers are **preliminary**: the Linux box was shared with other agents.

## Numbers

| | 1,000 seeds × 1k ops | 100 seeds × 10k ops |
|---|---|---|
| seeds passed (all checks below) | **1000 / 1000** | **100 / 100** ⁽¹⁾ |
| all 5 devices deep-equal to the oracle after quiescence | 1000 | 100 |
| ops lost (created node missing or deleted without a delete, text token missing or duplicated) | 0 | 0 |
| moments when the server's files didn't cover every uploaded op | 0 | 0 |
| update file deleted before every device had merged it | 0 | 0 |
| files written or deleted by two devices | 0 | 0 |
| file consumed with bytes ≠ server bytes (placeholder as data) | 0 | 0 |
| times the engine even tried to read a placeholder's bytes | 0 (8.5M placeholders seen) | 0 (5.2M seen) |
| new device that reads only the cloud files reaches the same state | 1000 / 1000 | 100 / 100 |
| converge after quiescence, simulated min, p50 / p99 / max | 52 / 112 / 145 | 62 / 139 / 139 |
| **catch-up after 12–36 h offline**, simulated min, p50 / p99 / max | 25 / 74 / **114** (1,419 returns) | 33 / 101 / **119** (145 returns) |
| others see the returning device's offline edits, p50 / max | 40 / 174 min | 51 / 135 min |
| catch-up merge CPU (Loro import), p50 / max ⚠️ preliminary | 38 / 88 ms | 503 / 1,123 ms |
| CPU per seed, peak RSS per seed process | 2.3 s, 182 MB | 43 s, 419 MB |

⁽¹⁾ In the first run, seed 5 crashed on a harness bug (see "Found along the way"; that run is kept in `results/first-attempt/`). After the fix, a full rerun passed: `results/on-10k.summary.json`. The other 99 seeds came out byte-identical in both runs.

Simulated time is dominated by the fake iCloud's delays, which are deliberately harsh: 3% of change notifications take 5–60 min, 2% of uploads take 2–30 min, 3% of downloads fail. Worst catch-ups: seed 112 in the 1k run (28.6 h offline, 114 min), and seed 36 in the 10k run (35 h offline, 1,157 files to import, 119 min).

### Files and bytes on the cloud, per seed (10k ops, 5 devices, mean / max)

| hour | 6 | 12 | 24 | 36 | 48 | end |
|---|---|---|---|---|---|---|
| **compaction on**: files | 125 / 315 | 231 / 568 | 404 / 1,075 | 479 / 1,670 | 166 / 1,619 | **61 / 104** |
| bytes | 60 / 125 KB | 127 / 305 KB | 281 / 533 KB | 402 / 836 KB | 424 / 1,060 KB | **419 / 916 KB** |
| **compaction off**: files | 285 / 355 | 545 / 731 | 1,110 / 1,370 | 1,716 / 1,895 | 2,314 / 2,422 | **2,346 / 2,422** |
| bytes | 58 / 74 KB | 112 / 150 KB | 231 / 290 KB | 361 / 394 KB | 490 / 510 KB | **509 / 523 KB** |

Peak per seed: on = 1,160 files / 1.0 MB (mean), off = 2,346 files / 509 KB. 27 snapshots were written per seed, each ~364 KB.

- Compaction keeps the **file count** bounded (61 vs 2,346). It does **not** save bytes on a doc this small: a snapshot holds the whole doc, so bytes stay about the same, and the peak is higher.
- Files pile up while any member is offline, because nothing is deleted until every member has acknowledged it (hours 24–42: ~480 files). They drop within hours of the device's return.

### 50k-block fixture (`spikes/shared/fixture`, 2 seeds × 1k ops; device 0 imports the graph, everyone syncs it)

| | compaction on | compaction off |
|---|---|---|
| seeds passed | 2 / 2 | 2 / 2 |
| cloud files at end | 55 | 260 |
| cloud bytes at end / peak | 12.7 MB / **25.3 MB** | 7.8 MB / 7.8 MB |
| catch-up after 13–36 h offline, max (simulated) | 51 min | 56 min |
| catch-up merge CPU, p50 / max ⚠️ preliminary | 1.8 / 3.9 s | 1.2 / 1.7 s |
| CPU, peak RSS per seed process | 247 s, 1.9 GB | 206 s, 1.8 GB |

On a big graph, a snapshot (history + state, 12.6 MB) is bigger than the same history as one update blob (7.8 MB). `scratch/compact-format.ts` measured the import cost: the snapshot imports in 8 ms, the update blob in 1.1 s. So snapshots are still the right compaction format for fast opens. The costs:

- ~60% more bytes
- each compaction uploads 12.6 MB, and every other device downloads it once to confirm it
- the peak doubles while the old copy waits to be deleted

## The design that passed

```
iCloud Drive/seqno/<graph>/
  updates/<deviceId>/<n>.loro   my ops only, n = first op counter in the file -> a name is never reused
  snapshots/<hash>.loro         full Loro snapshot, hash = sha256(peerId + bytes)
  seen/<deviceId>.json          NEW: { vv: what I've merged, verified: snapshots I downloaded + checksummed,
                                       snapshots: my snapshots and their version vectors }
```

Each device runs one loop: list → import new update files → check snapshots → read others' `seen` → write its own `seen` → maybe compact → maybe delete.

**Deletion rule.** A device deletes only files it wrote itself.

| file | deleted when |
|---|---|
| my update file U | every member's `seen.vv` covers U **and** a *confirmed* snapshot covering U is listed |
| my snapshot S | a different *confirmed* snapshot strictly above S is listed (VV covers S, ties broken by name) |
| a conflict copy `x 2.loro` in my folder | the same rule as the original (its bytes are a copy, so importing it is harmless) |
| a conflict copy of my `seen/<me> 2.json` | right away (only `seen/<me>.json` is ever read) |

*Confirmed* = a device other than the writer downloaded it, checksummed it, and said so in its `seen` file. That is the only proof the snapshot's bytes are on the server, not just in the writer's upload queue.

**Why no data can be lost.** Invariant: the server's files always cover every op ever uploaded.

1. Only deletions can break it, and only the writer deletes (checked: 0 multi-writer).
2. Deleting U needs a confirmed snapshot S ⊇ U, and S was on the server when it was confirmed. If S has been deleted since, that needed a confirmed S′ ⊋ S, and so on. "Strictly above" can't loop, so this chain ends at a snapshot that hasn't been deleted. That snapshot was on the server before the link below it was removed, so it is still there and still covers U.
3. Stale listings, delays and reordering can only postpone a deletion. They can't make an unconfirmed file count as confirmed.
4. Acks only grow, and a `seen` file is written after the merge, so it can only under-report. So no member ever needs a snapshot to recover ops it hadn't merged yet, which is the prompt's "never delete what another device hasn't merged".
5. Clocks are never used for ordering or safety. They only throttle work, and a clock that jumps backwards counts as "long enough ago".

**Placeholders.** Whether a file is data is decided from the listing and `stat` (a dataless flag, or a `.name.icloud` stub). It is never decided by reading. Unread files are requested and retried on the next pass. Snapshots are checksummed with `decodeImportBlobMeta(bytes, true)`.

## What the fake iCloud does

| fault | how |
|---|---|
| per-device views | each device sees its own copy of the folder. Changes arrive via per-file notifications with random delays: 80% 1–15 s, 17% to 5 min, 3% to 60 min |
| out-of-order arrival | every upload, notification and download has its own random delay. Uploads: 85% 0.5–5 s, 13% to 2 min, 2% to 30 min |
| placeholders | `dataless` style (Mac, web, iOS): the name is visible, `read()` throws until downloaded. `stub` style (old iOS): only `.name.icloud` is listed. iOS devices don't auto-download |
| eviction | every ~45 min, 30% of downloaded files go back to placeholders |
| failed downloads | 3% |
| offline | short drops (~20 min every ~3 h), plus 1–2 devices per seed offline for 12–36 h (25% of them from t=0) |
| clock skew | ±2 h per device, plus one jump of −3 h…+1 h. The engine uses only its own skewed clock |
| conflict copies | 1% of uploads also create `<name> 2.loro` (`2.json`, …), holding the previous or the same bytes |

Workload, 5 devices: insert text 34%, delete text 8%, create block 20%, delete block 5%, move 20%, concurrent move pairs that would form a cycle (X under Y on one device, Y under X on another) 5.5%, rename page 4%, create page 3%, delete page 0.5%. Batches flush at 20–60 ops, after 5 s idle, or at most 60 s after the first op. A device compacts once ≥ 100 + 20·id update files aren't covered by a snapshot, at most once an hour, and only if it isn't behind.

## The checks bite (mutants)

`node scripts/mutants.ts --seeds 16`: each removes one safeguard. Every one is caught.

| removed safeguard | seeds caught | what fired |
|---|---|---|
| treat a placeholder as an empty file | 16 / 16 | placeholderAsData, diverged, noConvergence |
| delete without waiting for acks | 16 / 16 | ackUnsound |
| delete updates with no covering snapshot | 16 / 16 | lostCoverage, bootstrap (new device can't rebuild) |
| trust my own just-written snapshot (no confirmation) | 7 / 16 | lostCoverage: the delete reached the server before the snapshot did |
| delete other devices' files | 16 / 16 | multiWriter |

## Found along the way

- **Loro panics on a bad argument instead of throwing.** `tree.has(undefined)` (or `null`) aborts inside wasm with `RuntimeError: unreachable` (`loro-common/src/lib.rs:1243`, unwrap on None). A strict string like `"x"` just returns `false`. The harness hit this when its RNG returned exactly 0 and an index went out of range (seed 5, fixed in `workload.ts`). App takeaway: validate IDs before calling into Loro. A wasm panic isn't a normal JS error, and it isn't safe to keep using the doc after one.
- **Float time froze the sim.** With a skewed float clock, a throttle wait shrank below one float step, so time stopped advancing (seeds 57/261/358). Fixed by giving devices whole-millisecond clocks, which real clocks are. Seeds that run too long are now killed and reported (`--timeout-s`).
- **Worker threads leaked ~3 MB per seed** and the cgroup killed the run at 3 GB. The runner now forks one process per seed, and RSS is flat at 170–420 MB per seed.
- 1 seed in 1,000 had two devices write byte-identical snapshots. Snapshot names hash in the peer ID, so this is harmless. Hashing content alone would have given two writers the same file.
- Merge CPU on catch-up is mostly Loro replaying concurrent moves. Importing a concurrent move costs 6–40 ms on a 2.5k-node tree, and in one 10k-op seed import calls had p90 14 ms and max 661 ms. This belongs to web-perf / ios-loro, but it shows up here first.

## What the app must carry over

1. Add `seen/<deviceId>.json` to the locked layout. It's tiny, has one writer, and is overwritten in place.
2. Never reuse a peer ID. File names are op counters, so a reinstall needs a new peer/device ID.
3. Deletion needs **confirmation by another device**, not just "my snapshot exists".
4. **Membership is a product decision.** A member device that never comes back blocks every deletion forever (safe, but files grow). The app needs an explicit "remove this device", which drops it from the ack set. Skipping its ack stays server-safe, because snapshots cover everything, but that device would then need a snapshot to catch up.
5. Timers should use integer ms, and a backwards clock jump should count as "elapsed".

## Scale, gaps, blocked

- **Scale actually run: 1,000 × 1k ops + 100 × 10k ops** (compaction on), plus 100 × 1k and 20 × 10k with compaction off. All passed. The prompt's bar was 1,000 × 10k. The earlier orchestrator note (`ORCHESTRATOR_NOTE.md`) lowered it after earlier attempts ran this shared box out of memory. 1,000 × 10k is ~12 CPU-hours (43 s per seed): ~3 h at 4 workers, ~1 h at 12 on a quiet 16-core machine with ~5 GB RAM. The command is below.
- Not modeled: truncated or corrupt update files (only snapshots are checksummed), iCloud losing a file outright, restoring a device from backup (reused peer ID), members joining or leaving mid-run, `mirror/` and `assets/`.
- The fake iCloud's behavior (dataless `stat`, `.icloud` stubs, conflict-copy naming) is an assumption. The chrome-icloud / ios-icloud spikes should confirm it on the Mac.
- Nothing blocked.

## How to rerun

Every command is deterministic (fixed seeds) and prints one JSON summary on stdout. Exit code is 0 only if every seed passed. `--out x.jsonl` streams one line per seed. The same seed gives byte-identical results except CPU fields (checked).

```sh
cd ~/dev/seqno/spikes/sync-sim && pnpm install --frozen-lockfile
CAP="systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0"

$CAP node scripts/mutants.ts --seeds 16                                          # ~1 min
$CAP node scripts/run.ts --seeds 1000 --ops 1000  --compaction on  --workers 4    # ~10 min
$CAP node scripts/run.ts --seeds 100  --ops 10000 --compaction on  --workers 4    # ~18 min
$CAP node scripts/run.ts --seeds 20   --ops 10000 --compaction off --workers 4    # ~5 min
systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 \
  node scripts/run.ts --seeds 2 --ops 1000 --base fixture --compaction on --workers 2   # 50k-block graph
# the original bar (not run here):
$CAP node scripts/run.ts --seeds 1000 --ops 10000 --compaction on --workers 4
```

Results from this run are in `results/` (`*.summary.json` = stdout, `*.jsonl` = per seed, `*.log` = progress).
