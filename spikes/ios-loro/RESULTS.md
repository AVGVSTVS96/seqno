# ios-loro: can iOS run the same Loro engine (1.16.2) fast enough?

**Short answer: yes, with candidate 1 (loro-react-native built from git with loro-ffi =1.16.2), if we build Rust at `opt-level=3` and load blocks lazily.**
The state is identical to the web, and snapshots import in both directions. Typing and moves are ~300x under the bar. Merge and memory sit right at the bar.

All numbers are **preliminary**. Setup: iOS 27 simulator (iPhone 17 Pro), Release build, Hermes, on the M1 Max. During the runs the Mac had load average ~500 and was swapping. The simulator on an M1 Max is also faster than a real iPhone, so a real-device run is still needed.

## Numbers (50k-block graph, 17 MB snapshot, 5.67M ops of history)

Candidate 1, `opt-level=3`, two runs each:

| bar | lazy open (page list + today's page) | full open (all 51,865 nodes into a JS map) | web reference (Node 24 + loro-crdt wasm, Ryzen 5700G) |
|---|---|---|---|
| open <= 1 s | **176 / 180 ms** ✅ (import 36-41, page list 127-138, first page 2-3) | 2,485 / 2,486 ms ❌ (2.39 s is moving the tree across uniffi) | lazy 214-228 ms, full 1,467-1,517 ms |
| keystroke p95 <= 16 ms | **0.049 ms** ✅ | 0.051 ms ✅ | 0.065-0.069 ms |
| move p95 | – | **0.045 / 0.047 ms** ✅ | 0.060-0.065 ms |
| merge 1k remote edits <= 50 ms | **56 / 51 ms** ⚠️ | 63 / 58 ms ⚠️ | 48-52 ms |
|   - engine only (no subscriber) | 27 / 25 ms | 24 / 23 ms | 22-33 ms |
|   - concurrent with local edits | 53 / 60 ms | 58 / 69 ms | 55-58 ms |
|   - first import after open (one-time) | 96 / 93 ms | 119 / 120 ms | 110-138 ms |
| memory <= 150 MB (phys_footprint) | **144 MB at end, 150.1-150.5 MB peak** ⚠️ | 304-306 MB opened, 447 MB at end ❌ | – |
| identical state, web vs iOS | **pass** ✅ (see cross-check) | | |

How memory breaks down (lazy run): the empty RN + Hermes app uses 46 MB. Importing the snapshot brings it to 64 MB, opening the page list and today's page to 87 MB. After 3k merged remote edits and 1,050 keystrokes it reaches 144 MB. The JS heap stays around 12 MB, so roughly **85-95 MB is the Loro doc itself** once its history is fully decoded. The web uses about the same: wasm memory is 116-198 MB.

### Upstream build profile (`opt-level="z"`) vs `opt-level=3`, same app, back to back

| | z (upstream) | 3 |
|---|---|---|
| snapshot import | 214-215 ms | 31-41 ms |
| lazy open | 404 ms | 161-180 ms |
| full materialize | 4,359 ms | 2,382-2,394 ms |
| merge 1k warm (with events / engine only) | 124-125 / 65-66 ms | 51-63 / 23-27 ms |
| keystroke p95 | 0.059-0.060 ms | 0.049-0.051 ms |
| app size | ~36 MB (earlier build) | 38 MB (static lib 11.1 → 11.9 MB) |

### Candidate 2: loro.js 0.3.0 on Hermes (lazy mode) ❌

Import takes 9.6 s, lazy open 10.8 s. Merging 1k edits takes 18.7 s the first time and 5.2 s after that (1.7 s with no subscriber). Keystroke p95 is 0.098 ms. Memory is 224 MB right after import and 514 MB at the end. It also gets correctness wrong: on Node it imports the 1.16.2 snapshot correctly, but its merge events don't match the doc's real state. The block map ends up wrong, and the next `move` throws `tree index N is out of range`.

### Candidate 3 (WebView + wasm): not built

The plan says to try it only if 1 and 2 both fail. Candidate 1 is right at the bar (merge 51-63 ms, memory peak 150.1-150.5 MB, measured on a saturated Mac) rather than clearly failing, so I stopped there. If quiet reruns put it clearly over, building candidate 3 is your call. Even then it couldn't do better on merge. Native engine-only merge (23-27 ms) already matches wasm on V8 (22-33 ms). The extra merge cost comes from delivering events, and a WebView would add a bridge on top of that.

## Cross-check (web vs iOS): pass

Both sides start from the same web-made 50k snapshot and use peer 7. Each generates 10k edits from seed 777: 5,535 insertText, 1,414 deleteText, 1,209 createBlock, 1,254 moveBlock, 588 deleteBlock. On iOS the edits are generated in Hermes, and the edit digest `5a8abe991f1ac71e` matches the web. Each edit is applied with its own commit.

- The full doc JSON is deep-equal: 52,005 tree nodes, state digest `6dc984d03aafae4e`.
- Version vectors are identical `{1: 5666289, 7: 77133}`, and so are the frontiers.
- The iOS snapshot imports into loro-crdt 1.16.2 with equal state and version vector. The web snapshot imports on iOS, and every iOS run starts from it.
- On both sides, the event-driven block map matches the fixture's reference model.
- This passed on both the `z` and the `3` build.

## How to rerun (from Linux)

Setup is needed once, or after code changes. It syncs the code and fixtures to the Mac, swaps in the opt-level 3 library, and builds the app:

```sh
cd ~/dev/seqno/spikes/ios-loro && node scripts/prep.ts && ./scripts/sync-mac.sh
ssh mac 'cd ~/Developer/seqno-spikes/ios-loro && sh host/build-loro.sh 3 && node host/run.ts build'
```

| what | command (prints JSON) |
|---|---|
| iOS bench, lazy open | `ssh mac 'cd ~/Developer/seqno-spikes/ios-loro && node host/run.ts bench loro-react-native lazy'` |
| iOS bench, full open + moves | `ssh mac 'cd ~/Developer/seqno-spikes/ios-loro && node host/run.ts bench loro-react-native full'` |
| upstream `z` build | `ssh mac 'cd ~/Developer/seqno-spikes/ios-loro && sh host/build-loro.sh z && node host/run.ts build && node host/run.ts bench loro-react-native lazy'` |
| candidate 2 | `ssh mac 'cd ~/Developer/seqno-spikes/ios-loro && node host/run.ts bench loro.js lazy'` |
| cross-check | `cd ~/dev/seqno/spikes/ios-loro && node scripts/crosscheck.ts loro-react-native` (exits 1 on mismatch) |
| web reference | `cd ~/dev/seqno/spikes/ios-loro && node --expose-gc scripts/bench-node.ts loro-crdt lazy` (or `full`) |

How it works:
- `host/run.ts` boots a dedicated `seqno-ios-loro` simulator, headless with `xcrun simctl` only. It copies the fixture into the app's Documents, writes `job.json`, and launches the app.
- At each checkpoint the app pauses while `footprint` reads its memory.
- Results land in `~/Developer/seqno-spikes/ios-loro/results/ios/*-latest.json`.
- Seeds are fixed. Raw JSON from this run is in `results/` (gitignored).

To rebuild the binding from scratch on the Mac, run `sh host/build-binding.sh`. It clones `loro-react-native@8fad8d6`, applies `host/loro-react-native-1.16.2.patch` (Cargo pins and lockfile, package.json, drops the x86_64 sim target), then runs ubrn and npm pack. I ran it from a clean clone: the package it produces matches the one the app uses, file for file, except for the compiled static libraries.

## What I had to fix (not Loro problems)

- **Release simulator builds failed to link (`library 'loro_rs' not found`).** The xcframework only ships arm64 slices, but the sim build asks for `arm64 x86_64`. Building with `ARCHS=arm64` fixes it.
- **The iOS 27 SDK traps at launch without the UIScene lifecycle**, and the Expo SDK 57 template doesn't use it. `app/app.config.ts` switches to expo's built-in `ExpoAppSceneDelegate`. This is the same fix the ios-icloud spike uses.
- **Homebrew's `cargo`/`rustc` come first on the Mac's PATH and have no iOS std.** The build scripts use the rustup toolchain explicitly.

## Open decisions

1. **Ship loro-react-native with `opt-level=3`** instead of upstream's `"z"`. It's 2-6x faster for about +2 MB of app size.
2. **Load blocks lazily on mobile.** Loading the whole tree into JS through uniffi takes 2.4 s and 300+ MB at 50k blocks. The other route is a small fork change: a Rust function that returns the tree as a JSON string.
3. **Merge sits at about 50 ms on both web and iOS.** About half is the engine import (~25 ms) and half is delivering events into JS. The first import after opening costs an extra ~100 ms once; warming it in the background after open would hide it.
4. **Memory sits at about 144-150 MB, almost all of it the doc's full edit history** (5.67M ops). The `snapshots/` compaction step (for example, dropping history with shallow snapshots) is the lever if a real iPhone is tighter.

## Caveats

- The Mac was saturated (load ~500, swapping) during every run, so the verify lead should rerun everything one at a time.
- The simulator on an M1 Max is much faster than an iPhone, so a real-device run is still needed. The Mac has no signing identity, so that run is blocked until a team is set up.
- An `iPhone 17` simulator booted at 02:14, probably by the earlier run's `expo run:ios`, is still booted and idle. I left it alone because I can't be sure it's mine.
