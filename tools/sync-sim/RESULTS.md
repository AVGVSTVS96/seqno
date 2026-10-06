# sync-sim results (phase 1)

The phase 0 fake-iCloud simulator, ported into a repo tool. Five devices edit one graph through domain `Command`s for 12-48 simulated hours against a hostile fake iCloud. At the end, every device must match an oracle, with no lost op, no file that two devices wrote, and no placeholder read as data.

## What works

- **The hostile fake iCloud** (`src/cloud.ts`), same model as the spike. Each device has its own view of the folder. Notifications, uploads and downloads arrive late and out of order. Placeholders come in two styles: `dataless` (Mac, web, iOS) and `.name.icloud` stubs (old iOS). It also evicts files, fails 3% of downloads, writes `x 2.loro` conflict copies, drops devices offline for short spells and for 12-36 h, and skews and jumps device clocks.
- **Two Effect services are the swap points** (`src/ports.ts`). The sim talks only to these, so integration can swap in the real packages with a Layer:

  ```
   workload --Command--> Graphs.open(...) -> Replica      <- @seqno/graph goes here
                                                ^
   fake iCloud --CloudFs--> Vaults.attach(spec, fs, replica) -> VaultSync { flush, pass, stats }   <- @seqno/vault goes here
  ```

  - `Graphs { open(spec): Effect<Replica, never, Scope | Crypto>, blobSpan(bytes, checksum) }`. A `Replica` is `dispatch(Command) -> GraphEvent[]` plus the reads the checks need (`block`, `pageAlive`, `children`, `fate`) and the edit-log surface the vault needs (`version`, `exportUpdates`, `exportSnapshot`, `importBlobs`, `canonical`).
  - `Vaults { attach(spec, fs: CloudFs, replica) }`. `CloudFs` is the file-adapter shape I expect the vault to have: Effect `list / stat / read / write / remove / download`. `read` fails with `NotDownloaded | NotFound`.
  - Time and randomness come only from Effect's `Clock` and `Crypto` services. The sim gives each device a skewed, jumping `Clock` and a seeded `Crypto`. So `newBlockId` / `newPageId` in a real graph stay deterministic per seed, with no change to their code.

- **Stand-in adapters**, so the sim runs before graph and vault land:
  - `LoroGraphs` (`src/loro-graph.ts`): a Loro movable tree where pages are roots and blocks hang under them. Text is a `LoroText` in `src`, and an `ids` LoroMap maps each `BlockId` / `PageId` to its `TreeID`.
  - `loroVaults(bug)` (`src/loro-vault.ts`): the spike engine that passed, written as Effect code. It follows the vault layout: `updates/<deviceId>/<n>.loro`, `snapshots/<hash>.loro`, and `seen/<deviceId>.json` (decoded with Schema). It deletes only its own files, and only after another device confirms a covering snapshot. It decides placeholders from `list` and `stat`, never by reading, and NFC-normalizes names on read.
- **The checks only look from outside**, at cloud hooks and replica reads. None of them needs a vault internal: `lostCoverage`, `ackUnsound`, `multiWriter`, `placeholderRead`, `diverged`, `lostOps` (oracle versions plus intent: every created node is alive, or deleted under an explicit delete, and every text token appears exactly once or not at all), `bootstrap` (a fresh device that reads only the cloud files reaches the oracle state), and `noConvergence`.
- **Mutants**: five deliberate vault bugs. Every one is caught.
- **The runner** forks one process per seed (wasm memory never shrinks), uses at most 4 workers and `--max-old-space-size=1024` per seed, and has a per-seed timeout. It streams one JSONL line per seed and prints a progress line every 10 seeds.

## Numbers from this session

| run                                | seeds passed | violations | notes                                                                                                                                                                |
| ---------------------------------- | ------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI suite: 50 seeds × 600 ops, 24 h | **50 / 50**  | 0          | wall 50 s at 4 workers, mean 3.5 s CPU per seed, max RSS 229 MB, 52 snapshots written (so compaction and deletion ran), 0 placeholder reads (243k placeholders seen) |
| mutants: 8 seeds × 1k ops each     | all 5 caught | see below  |                                                                                                                                                                      |
| 1k slice: 40 seeds × 1k ops, 48 h  | **40 / 40**  | 0          | wall 75 s at 4 workers, catch-up after 12-36 h offline p50 / max 30 / 87 simulated min, max RSS 231 MB                                                               |
| 10k slice: 2 seeds × 10k ops, 48 h | **2 / 2**    | 0          | 62 s CPU per seed, max RSS 406 MB, 62 cloud files at the end (compaction keeps the count bounded), catch-up max 38 simulated min                                     |

| mutant                  | seeds caught | what fired                             |
| ----------------------- | ------------ | -------------------------------------- |
| placeholder-as-empty    | 8 / 8        | diverged, noConvergence                |
| gc-without-acks         | 8 / 8        | ackUnsound                             |
| gc-without-witness      | 8 / 8        | lostCoverage, bootstrap                |
| gc-unconfirmed-snapshot | 5 / 8        | lostCoverage (the spike caught 7 / 16) |
| gc-any-device           | 8 / 8        | multiWriter                            |

A 1k-op seed costs about 4 s of CPU on its own, or 6.8 s with 4 seeds running at once, against 2.3 s in the spike. The extra time is the Effect layer over every pass and every command.

## How to run

```sh
CAP="systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0"
cd tools/sync-sim

$CAP npx vitest run --project @seqno/sync-sim                 # unit + 3 seed tests, ~7 s
$CAP node scripts/run.ts --suite ci                            # 50 seeds × 600 ops, ~1 min
$CAP node scripts/mutants.ts --seeds 8                         # ~1 min, exit 0 only if every bug is caught
$CAP node scripts/run.ts --suite 1k  --out results/1k.jsonl    # 1,000 × 1k ops, ~30 min at 4 workers
$CAP node scripts/run.ts --suite 10k --workers 3 --out results/10k.jsonl   # 100 × 10k ops, ~35 min; 3 workers × ~410 MB stays under 1.5 GB
```

Flags: `--seeds`, `--from`, `--ops`, `--hours`, `--devices`, `--compaction on|off`, `--bug <mutant>`, `--workers` (capped at 4), `--out`, `--timeout-s`. Exit code is 0 only if every seed passed. The same seed replays to the same result, except for CPU fields (a test checks this).

## Additions to the contract (for integration)

- `Replica.fate(id)` is `Missing | Alive { root } | Deleted { top }`. It exists only for the lost-op check. The real graph has to answer it from the Loro tree, including deleted nodes.
- `Graphs.blobSpan(bytes, checksum)`: start and end version vectors of an update or snapshot blob (`decodeImportBlobMeta`). The vault and the checks both need it.
- `VaultSync.pass` returns `{ wakeInMs }`, so a vault that throttles its `seen` write can ask to run again. `stats` reports `importedFiles`, `importedBytes` and `placeholdersSeen`.
- Device folders use `DeviceId`s `d0..d4`, and Loro peers are `1..5`.

## Known gaps

- **The full suites did not run here.** I ran only CI (50 seeds), the mutants, and small 1k and 10k slices. The commands for 1,000 × 1k and 100 × 10k are above.
- The stand-in graph rejects `SplitBlock`, `MergeWithPrevious`, `Indent`, `Outdent`, `Undo` and `Redo`, so the workload doesn't use them yet. Add them to the op mix once `@seqno/graph` lands.
- `MoveBlocks` can't target the root of an empty page (the contract gap the scaffold already noted), so those moves get skipped.
- The stand-in uses Loro's code-point text offsets. That only works because the sim's text is ASCII. The real graph must use UTF-16 offsets.
- The spike's `placeholderAsData` check needed a vault-internal hook. It is replaced by `placeholderRead`: the cloud counts every attempt to read a dataless file or a stub. The placeholder-as-empty mutant is still caught, by `diverged` and `noConvergence`.
- The parent process trusts the type of the result message from its own child (IPC). The config going the other way is Schema-decoded.
- The 50k-block fixture base from the spike is gone. It depended on `spikes/shared/fixture`, and `fixtures/` is another part's folder.
- The stand-in vault hashes snapshot names with `node:crypto`, so it is node-only. The real vault will hash with Web Crypto.
