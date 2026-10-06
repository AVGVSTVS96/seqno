
# seqno phase 0: go / no-go

2026-10-06. Built from the 5 spike write-ups (`spikes/*/RESULTS.md`) and `spikes/VERIFY.md`. The verify lead re-ran every spike between 06:15 and 06:47. All numbers are the verified ones unless marked *unverified*.

## Verdict: GO WITH CONDITIONS

The core design holds up:

- Loro 1.16.2 gives identical state on web and iOS.
- The iCloud file layout syncs with zero data loss.
- SQLite queries are fast and return correct results.

Two assumptions didn't hold:

- **Open can't load everything at once.** It has to be lazy (already decided).
- **Merge misses 50 ms under lazy open,** because the first merge pays to build Loro's state.

Also, the 150 MB memory bar measures different things on web and iOS.

```
correctness  web == iOS state        pass     deep-equal, same version vector, 2 seeds
             sync, zero loss         pass     200 new seeds + 2 on the 50k graph, 0 violations
             query results           pass     independent oracle, exact match
speed        typing                  pass     0.14 ms web, 0.053 ms iOS   (bar 16)
             open, lazy              pass     178 ms iOS, 388 ms web + ~0.3 s file reads
             open, full              FAIL     1.2-1.3 s web, 2.4 s iOS    -> lazy, decided
             merge 1k edits          FAIL     97-110 ms first after open  (bar 50)  -> D1
memory       150 MB bar              UNCLEAR  web and iOS count different things    -> D2
access       iOS iCloud container    BLOCKED  needs paid Apple Developer Program (phase 3)
```

**Conditions for starting phase 1:**

1. Decide D1 (merge bar) and D2 (memory definition). Both change what phase 1 has to prove.
2. Approve D3 (`seen/` folder). It changes the locked iCloud layout.

D4-D6 can be decided during phase 1. Nothing blocks phases 1-2 or desktop.

## 1. Spikes at a glance

| spike      | verify                  | metric                              | official                                            | bar          | result       |
|------------|-------------------------|-------------------------------------|-----------------------------------------------------|--------------|--------------|
| web-perf   | partial                 | open, full block map                | 1181 ms (1313 ms with 200 update files)             | ≤ 1000 ms    | FAIL         |
|            |                         | open, lazy first page               | 388 ms, plus ~300 ms file reads (estimate)          | ≤ 1000 ms    | pass         |
|            |                         | keystroke p95, round trip           | 0.14 ms                                             | ≤ 16 ms      | pass         |
|            |                         | merge 1k, after lazy open (Node V8) | 110 ms first, 48.9 ms warm                          | ≤ 50 ms      | FAIL first   |
|            |                         | memory, wasm + JS heaps only        | 131 MB open, 133 MB after 10k edits                 | ≤ 150 MB     | pass         |
|            |                         | memory, whole tab process           | 242 MB full open, 381 MB with SQLite; 146 MB lazy   | ≤ 150 MB     | FAIL / edge  |
| ios-loro   | partial                 | open, lazy                          | 178 ms                                              | ≤ 1000 ms    | pass         |
|            |                         | open, full (51,865 nodes)           | 2435 ms                                             | ≤ 1000 ms    | FAIL         |
|            |                         | keystroke p95                       | 0.053 ms                                            | ≤ 16 ms      | pass         |
|            |                         | merge 1k, warm / first after open   | 57.6 / 97 ms (engine alone 23.5 ms)                 | ≤ 50 ms      | FAIL         |
|            |                         | memory peak, whole process, lazy    | 149.4 MB                                            | ≤ 150 MB     | pass by 0.6  |
|            |                         | web vs iOS, 10k edits               | identical on seeds 777 and 4242                     | identical    | pass         |
| queries    | confirmed               | slowest of 15 queries, p95          | 12.9 ms                                             | ≤ 50 ms      | pass         |
|            |                         | index + live refresh per keystroke  | 5.6 ms p95 relaxed (14.1 durable), in the worker    | 16 ms        | pass         |
|            |                         | live re-runs per keystroke / stale  | 1.05 of 20 / 0                                      | only on change / 0 | pass   |
|            |                         | results vs independent oracle       | 5 queries, 0 missing, 0 extra                       | correct      | pass         |
| sync-sim   | confirmed, reduced scale| 100 new seeds × 10k ops             | 100/100, 0 lost ops, 0 violations                   | all          | pass         |
|            |                         | removed safeguards caught           | 5/5                                                 | all          | pass         |
|            |                         | 50k graph, 2 new seeds              | 2/2; cloud 12.7 MB end, 25.3 MB peak                | all          | pass         |
|            |                         | 1,000 seeds × 10k ops (original)    | not run                                             | ≥ 1,000      | NOT RUN      |
| ios-icloud | partial, blocked on ADP | iOS sim end-to-end checks           | 9/9 in 5 runs                                       | 9/9          | pass         |
|            |                         | iOS sim atomic write, 4-12 KB       | 2.8-3.6 ms                                          | ≤ 16 ms      | pass         |
|            |                         | macOS real iCloud write, p95        | 37.6 ms                                             | 16 ms if on keystroke path | keep it off |
|            |                         | 32 MB atomic write, partial file    | never seen                                          | never        | pass         |
|            |                         | iOS iCloud container                | can't be provisioned                                | works        | BLOCKED      |

What these numbers don't cover yet:

- **Web lazy merge was measured in Node (V8), not Chrome.** It's the same loro-crdt 1.16.2.
- **Open times start with the bytes already in memory.** Real storage (OPFS, File System Access) wasn't measured. The iOS lazy open also had no update files.
- **iOS numbers come from an M1 Max simulator.** A real iPhone is slower, and that run is blocked on signing.
- **2 of the 9 iOS end-to-end checks can't fail yet.** The conflict checks pass on an empty list until a second iCloud device exists.

## 2. Decisions for you

### D1. Merge bar under lazy open (reopens "merge accepted")

The earlier "accept" was based on 44 ms, which was measured after a full open. With lazy open, the first merge pays to build Loro's state:

```
merge 1k remote edits     first after open   warm      engine only
web (Node V8, lazy)       110 ms             48.9 ms   -
iOS sim (O3, lazy)        97 ms              57.6 ms   23.5 ms
bar                       50 ms              50 ms
```

- On iOS, about 34 of the 57.6 ms is spent handing events to JS across uniffi.
- Catching up after a long time offline costs far more: 1.5-1.8 s of CPU on the 50k graph (sync-sim, Node). So merges can't run on the thread that handles typing, whatever the bar is.
- Web already merges in a worker. The iOS bench merges on the React Native JS thread, and events fire synchronously inside the import.

| option | what it means |
|---|---|
| **A** | Keep 50 ms as a hard gate. Phase 1 tries two fixes: warm the doc in the background after open, and send events only for open pages. Neither has been tested. |
| **B** | Change the bar to "a merge never blocks typing". Web already does this with its worker. iOS needs Loro moved off the JS thread, which is new and untested work. 50 ms warm becomes a target, not a gate. |
| **C** | Accept today's numbers as they are. |

Don't bother with the WebView + wasm candidate. Native Loro alone already merges as fast as wasm, so a WebView can only add cost.

**Recommendation: B**, with A's two fixes as phase 1 tuning. Catch-up merges take seconds no matter what, so the property that matters is that they never touch typing.

### D2. What the 150 MB memory bar measures

```
                             web                          iOS sim
spike counted                wasm + JS heaps: 131 MB      whole process: 149.4 MB peak
whole process, lazy          146 MB peak (open only)      149.4 MB (after merges, typing, export)
whole process, full open     242 MB, 381 MB with SQLite   303 MB, 451 MB peak
```

- Neither platform has measured the lazy path with the SQLite index loaded. On web, SQLite added ~62 MB in the full-open probe, so lazy will probably go over 150 MB (estimate).
- On iOS, the empty React Native app is 46 MB. Most of the rest is the Loro doc's full edit history, about 85-95 MB (*unverified* breakdown).

| option | what it means |
|---|---|
| **A** | Measure the whole process on both platforms and keep 150 MB. |
| **B** | Measure the whole process on both platforms, and set each platform's number after the real-iPhone run. |
| **C** | Count only the engine and JS heaps on both platforms. |

**Recommendation: B.** The whole process is what the OS kills and what users see, and it's the only way to compare web with iOS. Treat 150 MB as the target until then. If memory is tight, the fix is shallow-snapshot compaction to drop old history. That's untested, and it has to fit the sync deletion rules.

### D3. Add `seen/<deviceId>.json` to the locked iCloud layout

Deleting files safely needs two things: every device acknowledges what it has merged, and a device other than the writer confirms each snapshot. With the confirmation step removed, 7 of 16 seeds briefly lost ops on the server.

| option | what it means |
|---|---|
| add it | A few hundred bytes per device, one writer, overwritten in place. Leaves 49 files at the end of a 10k-op run. |
| never delete | No new folder, but 2,346 files per 10k ops, growing forever. |

**Recommendation: add it.** It's the only thing that makes deletion provably safe.

### D4. A device that never comes back

A device that never returns blocks all deletion forever. That's safe, but files pile up: the peak is ~1,190 files per seed while a member is offline, against 49 at the end.

| option | what it means |
|---|---|
| explicit removal | A "remove this device" setting drops it from the ack set. |
| timeout | Drop it automatically after something like 30 days unseen. |
| never | Files grow forever. |

**Recommendation: explicit removal.** The cloud copy stays safe even if you remove the wrong device, because snapshots cover everything. A timeout can come later as a prompt, not as something that happens silently.

### D5. Compaction format for big graphs

On the 50k graph:

- a snapshot is 12.6 MB and opens in 8 ms
- the same history as one update file is 7.8 MB and opens in 1.1 s

(*unverified*: from the lead's probe.) While compacting, cloud storage peaks at 25.3 MB, double the 12.7 MB it settles at (verified).

**Recommendation: snapshot.** Fast cold open is worth ~60% more cloud bytes. Keep compaction rare: at 100+ uncovered files, at most once an hour.

### D6. Run the original sync bar (1,000 seeds × 10k ops)?

Verify ran 100 new seeds at 10k ops in 13.6 min with 7 workers. Scaling that up, the full run is ~2.3 h at 7 workers (estimate), or ~1 h at 12 workers per the lead, using ~3-5 GB of RAM.

**Recommendation: run it once while you're not using the Linux box,** with a memory cap. Every 10k-op seed so far is deterministic and clean, so this confirms the result rather than exploring. It doesn't gate phase 1.

### Already settled (`spikes/decisions.json`)

| question                       | settled answer                                  | after verify |
|--------------------------------|-------------------------------------------------|--------------|
| how to open a graph            | lazy: page list + visible page first            | holds (178 ms iOS, 388 ms web) |
| merge margin                   | accepted, merges run in the worker              | **reopened as D1** (it was based on the full-open number) |
| iOS merge and memory           | wait for a quiet rerun                          | rerun done: see D1, D2 |
| query syntax                   | Logseq-style `{{query ...}}` (S)                | holds |
| SQLite index durability        | relaxed + version stamp + rebuild on mismatch   | holds (5.6 ms p95 per keystroke) |
| Rust opt-level on iOS          | 3                                               | holds (opt-level z: lazy open 408 ms, merge 115 ms) |
| mobile block map               | lazy, same as web                               | holds (full map: 2.4 s, 303-451 MB) |
| where `iCloud Drive/seqno` lives | the app's own iCloud container               | holds, needs ADP |
| filename normalization         | ASCII sync names, NFC-normalized page names     | holds |
| Apple Developer Program        | decide at phase 3, individual is fine           | unchanged, see blockers |

## 3. Blockers

None for phases 1-2 or the desktop app. All three iOS blockers wait on one thing, a paid Apple Developer Program (ADP) team:

```
ADP enrollment -> Xcode account on the Mac -> bundle + container IDs -> iCloud-enabled iOS build
                                           -> real iPhone run (merge and memory margins)
                                           -> second-device tests (conflicts, remote latency, download status)
```

| blocker | why it matters | what unblocks it |
|---|---|---|
| iOS iCloud container | the app can't reach `iCloud Drive/seqno` on iOS | ADP. The free Personal Team has no iCloud (verified against Apple's capability table). |
| real-iPhone numbers | merge and memory are at the bar on a fast simulator | the signing team + your iPhone connected to the Mac |
| real iCloud on iOS | conflict versions, remote-to-local latency, NSMetadataQuery download status, whether iOS still shows `.icloud` stubs | a second iCloud device on the team: your iPhone with iCloud Drive on, or a test Apple Account you sign into an iOS 26.3 simulator once (iOS 27 simulators reportedly won't keep iCloud Drive on: forum report, *unverified*) |

Steps when phase 3 starts:

1. Enroll in ADP (99 USD/yr) with the Apple Account that should own seqno. Individual is fastest, and your name shows as the seller.
2. On the Mac, once, you add that account in Xcode > Settings > Accounts. This creates the development certificate. Agents can't touch accounts or the keychain.
3. Choose the final bundle ID and iCloud container ID (for example `app.seqno` / `iCloud.app.seqno`), then share the 10-character Team ID. **Container IDs can't be deleted.**
4. Agents build with `SEQNO_ICLOUD=1` and `xcodebuild DEVELOPMENT_TEAM=<TEAMID> -allowProvisioningUpdates`.
5. Connect your iPhone with iCloud Drive on. That covers the real-device run and the second-device tests.

There's also an untested fallback that needs no ADP: you pick an iCloud Drive folder once with the document picker and use a free Personal Team. The catch is reinstalling every 7 days, and the App Store needs ADP anyway.

## 4. What changes in the plan

**Design**

1. **Lazy open everywhere.** The page list and visible page load first; the rest fills in behind them. No platform builds the full block map at open.
2. **The iCloud layout gains `seen/<deviceId>.json`** (D3). A device deletes only files it wrote. It deletes an update file only once every member has acked it and another device has confirmed a snapshot that covers it.
3. **A "remove this device" setting** (D4).
4. **Peer IDs are never reused.** File names are op counters, so a reinstall or a restore from backup needs a new device ID.
5. **The iOS engine is settled:**
   - loro-react-native built from git (commit 8fad8d6 plus a patch)
   - loro-ffi pinned to =1.16.2, built at opt-level=3
   - arm64-only simulator builds
   - UIScene lifecycle, which the iOS 27 SDK requires
   - loro.js is out: 10 s to open, and its merge events are wrong. The WebView candidate isn't needed.
6. **On iOS, Loro moves off the JS thread** (if D1 = B). This is new work.
7. **Vault writes stay off the keystroke path and get batched.** Real iCloud write p95 on macOS is 37.6 ms.
8. **Check `downloadingStatus` before reading a synced file.** Reading an evicted file silently downloads it and blocks for ~0.85 s.

**Tests to add in phase 1** (gaps verify found)

- **Query results against an independent oracle.** Today's suite would pass a compiler bug. Start from `verify/scripts/queries-oracle.ts`.
- **Lazy open from real storage:** OPFS / File System Access on web, and snapshot plus update files on iOS.
- **Memory per D2,** on the lazy path with the SQLite index loaded.
- **New sync-sim cases:**
  - truncated or corrupt update files
  - a peer ID reused after a backup restore
  - iCloud losing a file
- **The full 1,000 × 10k sync run** (D6).

**Gotchas to carry over**

- **Loro `tree.has(undefined|null)` crashes inside wasm instead of throwing,** and the doc isn't safe to use afterwards. Validate IDs before calling Loro. (lead finding)
- **loro-crdt 1.16.2's `web/index.d.ts` doesn't export `init`.** Import it from `loro-crdt/web/loro_wasm.js`. (lead finding)
- **NSFilePresenter events are coarse.** Every event is "subitem changed", it arrives ~1.1 s late, bursts are merged, and downloads send nothing. Treat each event as "rescan this path".
- **Foundation writes NFD filenames, and JS compares strings byte by byte.** Keep sync names ASCII and NFC-normalize page names.
- **SQLite index writes sometimes spike** to 175 ms durable or 70-77 ms relaxed (p95 is fine). They happen in the worker, so typing isn't affected.

## Sources

- `/home/bassim/dev/seqno/spikes/VERIFY.md`: verified numbers and problems
- `/home/bassim/dev/seqno/spikes/verify/{linux,mac}/`: raw verify outputs and run logs
- `/home/bassim/dev/seqno/spikes/{web-perf,ios-loro,queries,sync-sim,ios-icloud}/RESULTS.md`: spike write-ups and rerun commands
- `/home/bassim/dev/seqno/spikes/decisions.json`: decisions already settled
