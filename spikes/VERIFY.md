# seqno phase 0: verify report

2026-10-06, 06:15-06:47. Every `measure` command was re-run one at a time per machine; benchmarks 3x (median shown), sweeps on a fresh 100-seed sample with new seeds. Raw output: `spikes/verify/{linux,mac}/*.out`, run log in `stream.log` next to them.

- **Linux**: Ryzen 7 5700G, Chrome 153 headless, Node 24.21, load ~1 during the timing runs.
- **Mac**: M1 Max, iOS 27.0 simulator (iPhone 17 Pro), macOS 26.6.1. No other agents running, but your own apps were open (load ~4.5, compared with 450-600 during the spike runs).

## Verdicts

| spike | verdict | why |
|---|---|---|
| web-perf | **partial** | Numbers reproduce within 2%. Keystroke, move and state checks pass by a wide margin, and full open fails as reported. Two of the passes don't hold up, though. Merge passes only on the full-open path we're not using. Memory passes only because it counts just the wasm and JS heaps; the Chrome tab process uses about 2x that. |
| ios-loro | **partial** | Loro 1.16.2 on both sides is confirmed. A new seed gives identical state. Lazy open and keystroke pass. Merge **fails** on the quieter Mac (57.6 ms warm, 97 ms first). Peak memory is 149.4 MB against a 150 MB bar. |
| queries | **confirmed** | All numbers reproduce, and live results never go stale. My independent check of query results matched exactly. |
| sync-sim | **confirmed** (reduced scale) | 200 new seeds pass with 0 violations, and all 5 mutants are caught. The original 1,000 × 10k bar was still not run. |
| ios-icloud | **partial** (blocked on ADP) | 9/9 in all 5 simulator runs, and the real-iCloud probe on macOS reproduces. The iOS iCloud container is blocked: I confirmed against Apple's live capability table that the free tier has no iCloud. |

## Official numbers

### web-perf (Linux, Chrome, 50k blocks, 3 runs of `node scripts/bench.ts`)

| metric | median (runs) | bar | |
|---|---|---|---|
| open: snapshot -> full block map | 1181 ms (1181/1180/1186) | ≤ 1000 | FAIL |
| open: snapshot + 200 updates -> full block map | 1313 ms (1308/1318/1313) | ≤ 1000 | FAIL |
| open: first page only, snapshot + 200 updates (**the lazy path we chose**) | 388 ms (388/388/389), not counting the file read | ≤ 1000 | pass |
| keystroke p95, round trip, includes event -> block map | 0.14 ms | ≤ 16 | pass |
| move p95, round trip | 0.08 ms | (16) | pass |
| merge 1k remote edits, first merge after a **full** open | 43.7 ms (43.7/43.4/44.3) | ≤ 50 | pass |
| merge 1k, **lazy** open, same loro-crdt 1.16.2 (V8 in Node, ios-loro `bench-node.ts lazy`) | first 110 ms, warm 48.9 ms, concurrent 50.3 ms | ≤ 50 | FAIL first / borderline |
| memory as the spike defines it (wasm + JS heaps) | 131 MB after open, 133 MB after 10k edits | ≤ 150 | pass |
| memory: Chrome tab process, private (my probe, full open) | 242 MB after open, 275 after edits+keys+moves, 319 after snapshot export, 381 with the SQLite index | ≤ 150 | FAIL |
| memory: Chrome tab process, private, peak during lazy first-page open | 146 MB (31 MB of it is the empty page) | ≤ 150 | at the bar |
| state checks (digests after open, merge, 10k edits, keystrokes, moves) | all true, 3/3 runs | identical | pass |

### ios-loro (Mac, iOS 27 sim, O3 build, 3 runs each)

| metric | median (runs) | bar | |
|---|---|---|---|
| lazy open (import + page list + today) | 178 ms (181/168/178); import 36.5 ms | ≤ 1000 | pass |
| full open (all 51,865 nodes over uniffi) | 2435 ms (2407/2435/2898) | ≤ 1000 | FAIL |
| keystroke p95 (insert + commit + event -> block map, events synchronous) | 0.053 ms | ≤ 16 | pass |
| merge 1k, warm, with events | **57.6 ms** (54.7/57.6/60.3) | ≤ 50 | FAIL |
| merge 1k, first after open | 97 ms (97/89/102) | ≤ 50 | FAIL |
| merge 1k, engine only (no subscriber) | 23.5 ms | (≤ 50) | pass |
| phys_footprint peak, lazy, including the snapshot export | **149.4 MB** (148.8/149.8/149.4); 46 MB is the empty RN app | ≤ 150 | pass by 0.6 MB |
| phys_footprint, full map | 303 MB after open, 451 MB peak | ≤ 150 | FAIL |
| web vs iOS, 10k edits/moves, seed 777 (spike's) and **seed 4242 (new)** | 8/8 and 7/7 checks pass: deep-equal state, identical VV and frontiers, iOS snapshot imports on web; digests 6dc984d0… / 210bc9c8… | identical | pass |
| upstream opt-level z (A/B, 3 runs) | import 218 ms, lazy open 408, merge warm 115, engine-only 62 | | worse, as reported |
| loro.js 0.3.0 (1 run) | import 9.0 s, lazy open 10.2 s, merge 18.1 s first / 5.1 s warm, 514 MB | all | FAIL, as reported |

### queries (Linux, Chrome sqlite-wasm OPFS, 50k blocks, 3 runs)

| metric | median | bar | |
|---|---|---|---|
| slowest of 15 queries, p95 (durable) | 12.9 ms (13.6/12.8/12.9), Q05; median query p95 1.7 ms | ≤ 50 | pass |
| slowest query p95 (relaxed PRAGMAs) | 12.9 ms | ≤ 50 | pass |
| index write + live refresh per keystroke p95, durable / relaxed | 14.1 ms / 5.6 ms (index alone 10.3 / 2.9) | 16 (off main thread) | pass |
| live re-runs per keystroke, 20 queries | 1.05 (key match alone: 4.11) | only on change | pass |
| stale results (`--verify-every=20`; vitest after every edit) | 0; vitest 54/54 | 0 | pass |
| index build | 2.14-2.22 s Chrome / 0.74 s node | info | |
| Logseq advanced queries auto-translated | 12/14 (5 with warnings), 2 need manual conversion | info | |

### sync-sim (Linux, new seeds 20001-20100)

| run | result |
|---|---|
| mutants (5 removed safeguards) | all caught: 16/16, 16/16, 16/16, 7/16 (unconfirmed snapshot), 16/16 |
| 100 seeds × 1k ops, compaction on | 100/100, all 8 violation counters 0, converge p50/p99 57/142 min, catch-up max 101 min |
| 100 seeds × 10k ops, compaction on (run once, 13.6 min) | 100/100, all counters 0, converge p50/p99 63/147 min, final files 49 mean / peak 1,186 mean, 0 placeholder reads |
| 20 × 10k, compaction off (baseline, seeds 1-20) | 20/20, final files 2,346 / 509 KB mean, identical to the lead's numbers (deterministic) |
| 50k fixture, 2 new seeds (101-102), compaction on | 2/2, 0 violations, cloud bytes 12.7 MB end / 25.3 MB peak, catch-up merge CPU 1.5-1.8 s |
| 1,000 × 10k (original bar) | not run: about 1 h at 12 workers, outside the 45 min budget |

### ios-icloud (Mac)

| metric | result | bar | |
|---|---|---|---|
| iOS sim e2e, Release ×3, Debug dev-client ×1, iCloud entitlements ×1 | 9/9 in all 5 | 9/9 | pass |
| iOS sim coordinated atomic write, 4-12 KB | 2.8-3.6 ms (Release) | ≤ 16 | pass |
| iOS sim 200 overwrites p50/p95 | 2.6 / 3.2 ms | p95 ≤ 16 | pass |
| macOS iCloud coordinated write 4 KB p50/p95, new file (3 runs) | 13.9 / 37.6 ms (local APFS: 9.4 / 21) | 16 if on the keystroke path | FAIL, so keep it off the keystroke path |
| macOS iCloud write -> isUploaded p50/p95 | 6.0 / 8.1 s | info | |
| evicted file | dataless, real name, no `.icloud` stub; a coordinated or plain read blocks ~0.85 s, then the bytes match | as claimed | pass |
| 32 MB atomic write partial sizes seen | none (non-atomic control: many) | never | pass |
| iCloud entitlement build | `FAKETEAMID.com.seqno.spike.vault`, adhoc, identityToken false | | blocked |

## Problems found

1. **Web memory doesn't measure the same thing as iOS memory.** web-perf counts only wasm linear memory and JS heaps (131 MB). iOS counts the whole process (`phys_footprint`, including the 46 MB empty app). Measured the same way on web (private memory of the tab process, page + worker), the full-open session uses 242 MB after open and 381 MB once the SQLite index is built in the same worker. The memory bar needs one definition before the two platforms can be compared. Probe: `spikes/verify/scripts/webperf-procmem.ts`.
2. **Lazy open moves cost into the first merge, on both platforms.** web-perf's 43.7 ms merge was measured after a full `toJSON`, which forces Loro to build its state. After a lazy open, the same loro-crdt 1.16.2 needs 110 ms for the first merge (231 ms if nothing was read), and warm merges sit at 49-50 ms. iOS: 97 ms first, 57.6 ms warm. The decided lazy-open design has not been shown to meet the 50 ms merge bar anywhere. Two likely levers: warm the doc in the background after open, and stop sending events to JS for pages that aren't open (about half of the iOS merge cost).
3. **iOS merge fails on a quieter Mac** (57.6 ms vs 50), and the engine alone is 23.5 ms. Peak memory is 0.6 MB under the bar. Both still need a real iPhone, which is blocked on signing.
4. **The open numbers leave out reading files.** Web open times start once the bytes are already in memory. Fetching the 201 files over loopback HTTP took another ~277 ms, plus ~20 ms of wasm init, so a real lazy open is more like 0.7 s. That still passes, but it hasn't been measured against real storage (File System Access / OPFS). iOS lazy open imports the snapshot only, with **no update files** (on web, the 200 updates turn a 14 ms import into 256 ms).
5. **The query test suite never checks that results are correct.** It checks AST equality across syntaxes, the printer round trip and no-stale. The no-stale check compares live results with a fresh re-run of the same SQL, so a compiler bug would pass it. I compared 5 queries against a plain-JS oracle on a new 20k-block graph (seed 4242): `(task now later)` 709/709, `(task done)` 340/340, TODO-not-under-DOING 346/346, `(property rating 5)` 6/6, `"review"` 1323/1323, with 0 missing and 0 extra. Script: `spikes/verify/scripts/queries-oracle.ts`. The suite should have tests like this.
6. **2 of the 9 iOS e2e checks can't fail locally.** The conflict checks pass on an empty list, and the iOS partial-write check took only 4 polls and had no non-atomic control. The macOS probe covers partial writes properly; real conflicts still need ADP plus a second device.
7. **sync-sim doesn't model** corrupt or truncated update files (only snapshots are checksummed), a device restored from backup reusing its peer ID, or iCloud losing a file. The lead listed these as gaps; I agree they matter, especially peer-ID reuse.
8. Minor: iOS keystrokes always append at the end of the text, while web inserts at a random index. The web keystroke check `text.includes(char)` is almost always true anyway. The real proof is the block-map-vs-Loro digest after the run, and I confirmed separately that 1.16.2 fires events synchronously inside `commit()`, so the timed window does include the block-map update.

## Checks that held

- **Loro version.** loro-crdt 1.16.2 in every pnpm lockfile and in installed `node_modules` (web-perf, sync-sim, ios-loro). iOS `Cargo.lock`: loro / loro-internal / loro-ffi 1.16.2 from crates.io; `loro-common`/`loro-kv-store` 1.16.0 are what loro-internal 1.16.2 itself requires. The built app binary contains `loro-ffi-1.16.2` and `loro-internal-1.16.2` paths, and the app reports `getVersion()` = 1.16.2. The linked `libloro_rs.a` md5 matches the O3 target (38b99322…). The app uses the git-built tgz, not npm 1.10.3.
- **Opens are cold**: each one is a new Worker with a new wasm instance, timed after the fetch. **Merges are real**: 5 merges into 5 fresh workers, digest checked each time, never re-importing into the same doc.
- **Keystroke and move timings include the event updating the block map** (synchronous events in 1.16.2, checked directly; iOS reports `eventsSynchronous: true`).
- **Crosscheck isn't vacuous**: the new seed gives a different state digest, iOS reported the same edits digest as web, and both block maps match an independent model of the edits.
- **sync-sim checks bite**: all mutants are caught. Convergence is compared against an oracle doc built from every exported update, plus a fresh device bootstrapping from cloud files only.
- **iCloud stayed inside `seqno-spike/`**: the scripts only use `…/com~apple~CloudDocs/seqno-spike/ios-icloud`, which is empty after the runs. Nothing else in iCloud Drive was read.
- **Machine state afterwards**: the Mac ios-loro app is rebuilt back to O3 with seed 777 (md5 checked). The `seqno-ios-loro` and `seqno-ios-icloud` simulators are shut down. The pre-existing "iPhone 17" simulator was left as found. No git commits.

## Rerun

```sh
# Linux, one at a time (heavy ones under systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0)
cd ~/dev/seqno/spikes/shared/fixture && pnpm test && node scripts/stats.ts
cd ~/dev/seqno/spikes/web-perf && node scripts/bench.ts > out.json          # 3x, ~40 s each
cd ~/dev/seqno/spikes/queries && node bench/web.ts                          # 3x; also --relaxed=1, --verify-every=20, node bench/node.ts, npx vitest run
cd ~/dev/seqno/spikes/ios-loro && node --expose-gc scripts/bench-node.ts loro-crdt lazy
cd ~/dev/seqno/spikes/sync-sim && node scripts/mutants.ts --seeds 16 && node scripts/run.ts --seeds 100 --from 20001 --ops 10000 --workers 7
# verify extras
node ~/dev/seqno/spikes/verify/scripts/webperf-procmem.ts                  # tab-process memory
node ~/dev/seqno/spikes/verify/scripts/queries-oracle.ts 4242              # query results vs plain-JS oracle
# Mac (driven from Linux)
ssh mac 'cd ~/Developer/seqno-spikes/ios-loro && node host/run.ts bench loro-react-native lazy'   # also: full
cd ~/dev/seqno/spikes/ios-loro && node scripts/crosscheck.ts loro-react-native
ssh mac 'cd ~/Developer/seqno-spikes/ios-icloud && bash scripts/icloud-bench.sh && bash scripts/sim-e2e.sh'
```

The full run scripts are `spikes/verify/linux-stream.sh`, `mac-stream.sh` and `mac-ab.sh`. To recheck the crosscheck with a new seed: set `editSeed` in the Mac copy of `ios-loro/src/crosscheck.ts`, run `node host/run.ts build`, then `node spikes/verify/scripts/crosscheck-seed.ts <seed>`. Afterwards restore with `scripts/sync-mac.sh` and rebuild.
