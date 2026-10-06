# @seqno/vault results (phase 1)

The edit-log file layer: Loro update files, snapshots and `seen` acks in a synced folder, with the
compaction rule from `spikes/sync-sim`. Two Effect services, one engine, four storage adapters.

```
Vault (engine)                                Storage (adapter)
  writeUpdate(bytes) -> updates/<me>/<n>.loro   list / read / write (atomic) / remove / download
  sync(replica)      -> SyncReport              ├─ @seqno/vault/node   nodeStorage, layerNode     (tests, Electron later)
                                                ├─ layerOpfs(graph)                               (browser, OPFS)
Replica (port the graph implements)             ├─ layerDirectoryHandle(handle)                   (Chrome, picked iCloud folder)
  version / merge(blobs) / snapshot             └─ makeFakeCloud(...).layer(device)               (tests: delays, placeholders)
  loroReplica(doc) adapts a LoroDoc
```

## What works

- **`Vault.writeUpdate(bytes)`** names the file from the blob itself: `n` is the start counter of this
  device's peer. It rejects bytes that are not a Loro update, blobs holding any other peer's ops,
  and a name that already exists (a reused peer id would otherwise overwrite history).
- **`Vault.sync(replica)`** runs the spike's loop in one call, so callers cannot get the order wrong:
  list, check snapshots (download and checksum each once), on a fresh replica import the newest
  snapshot first, import update files not covered yet, import a snapshot that is still ahead once
  no update file is waiting, read other devices' `seen`, write my `seen` (only after merging, only
  when it changed), maybe compact, then delete. It returns
  `{ merged, waiting, behind, written, deleted }` with vault paths.
- **Deletion rule** (only ever my own files):
  - my update file: every member's `seen.vv` covers it and a confirmed snapshot covers it
  - my snapshot: a different confirmed snapshot is strictly above it (ties broken by name)
  - a conflict copy of my `seen` file: right away. Conflict copies of updates follow the original's rule.
  - confirmed = another device downloaded and checksummed it and said so in its `seen` file.
- **Snapshot authorship survives restarts.** The spike kept "which snapshots are mine" in memory, so
  after a restart a device would confirm its own snapshot. Here a snapshot is mine when
  `sha256(peer + ":" + bytes)` equals its name, checked from the bytes.
- **Not downloaded is never empty.** A file is data only if it is not a placeholder (adapter flag, or
  an `.name.icloud` stub name), it reads without error, and it decodes as the right Loro blob kind
  with its checksum (`decodeImportBlobMeta(bytes, true)`). Anything else stays unmerged, is reported
  in `waiting`, gets a download request, and is retried next pass. A zero-byte or truncated read
  fails the checksum, so even an adapter that cannot see placeholders is safe.
- **Names** are NFC-normalized when read; I/O uses the name as listed. Listings are sorted
  (numeric-aware), so reports are deterministic on every adapter.
- **Atomic writes:** node writes a temp file in the same folder, `datasync`s, then renames. OPFS and
  directory handles use `createWritable()`, which only replaces the file on `close()`.
- **Adapters:** node fs; OPFS (`layerOpfs(graph)`); a picked folder (`layerDirectoryHandle(handle)`,
  fails with `PermissionNeeded` unless `queryPermission({ mode: "readwrite" })` is `granted`, since
  asking needs a user gesture in the UI); and `makeFakeCloud` for tests.
- **Fake cloud:** per-device views, uploads, change notices and downloads delivered with a seeded
  probability (so out of order across files, in order per file), three placeholder styles
  (`dataless` flag, `stub` `.icloud` names, `silent` zero-byte reads), eviction, server-side
  injection for conflict copies and corrupt files. Exported so graph and sync-sim tests can use it.

## Tests

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm exec vitest run packages/vault
```

22 tests, about 1.5 s. The browser tests start a Vite dev server and headless Chrome
(`channel: "chrome"`, so Google Chrome must be installed; it is at `/opt/google/chrome` here).

| file                   | covers                                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/sync.test.ts`    | fake cloud: file naming, rejected writes, the three placeholder styles, truncated files, 5 seeded runs of 3 devices typing and compacting through a slow cloud plus a fresh device opening from it, deletion waits for confirmation, an absent member blocks deletion, conflict copies |
| `test/node.test.ts`    | node fs: temp-file writes leave one file, missing folder and file, two devices sharing a folder through sync, compaction, deletion and a fresh device, `.icloud` stub never read                                                                                                       |
| `test/browser.test.ts` | headless Chrome: OPFS round trip, a granted directory handle, the same three-device flow on OPFS                                                                                                                                                                                       |

Mutants checked by hand: confirming my own snapshot, deleting without acks, and treating an
unreadable file as consumed each fail tests.

## Contract and repo additions (for integration)

- No changes to `@seqno/domain`. `DeviceId` is used as the folder and `seen` name.
- **`@seqno/vault/node` subpath export.** The node adapter imports `node:fs`, so it cannot sit in
  `src/index.ts`, which the web worker bundles. This is the one departure from "public API is
  `src/index.ts`".
- **`VaultConfig`** needs `peer` (the Loro peer id this device writes with) and `members` (whose
  acks deletion waits for), next to `device`, `compactAfterFiles` and `compactEvery`.
- **`Replica`** is the port the graph implements (`version`, `merge(blobs) -> boolean[]`,
  `snapshot`). `loroReplica(doc)` is a ready one for a plain `LoroDoc`.
- **Browser tests use Playwright and Vite directly, not Vitest browser mode.** Adding
  `@vitest/browser-playwright` to one package makes pnpm create a second `vitest` instance (it is an
  optional peer), and then `@effect/vitest` in `domain` and `rpc` fails with
  `Cannot read properties of undefined (reading 'config')`. If integration wants browser mode across
  packages (the UI features will), put `@vitest/browser-playwright` and `playwright` in the root
  `devDependencies` so every package resolves the same `vitest`.

## Known gaps

- **Chrome on an evicted iCloud file is unmeasured.** The chrome-icloud spike wrote no results. The
  adapter maps `NotReadableError` to "not downloaded" and has no way to request a download (reading
  is the request). If Chrome blocks ~0.8 s per evicted file like a plain read on macOS, a first
  sync over many evicted files is slow, since reads run one at a time.
- `createWritable()` on a real folder leaves `<name>.crswap` while writing; iCloud may sync it. The
  vault ignores names it does not recognize, but a crashed write can leave one behind.
- **Peer ids:** a device must keep its peer id and restore all of its own files before writing
  again. `writeUpdate` refuses to overwrite, but a lost local op counter would still mean new ops
  reuse counters. Graph should pick a fresh peer per install (spike rule 2).
- **Membership** is whatever the caller passes. Where the member list is stored and how a device is
  removed is still a product decision (spike rule 4).
- Not ported from the spike: the `seen` write throttle and the delay before importing a snapshot
  instead of small update files. The caller sets the pass rate; a snapshot that is ahead is imported
  as soon as no update file is waiting.
- A fresh device reads every update file once, even ones its snapshot already covers (it skips
  importing them, not downloading them). Knowing each device's peer would let it skip by name.
- A file that is corrupt for good stays in `waiting` forever and holds back compaction on every
  device. It is reported, not repaired.
- No file watcher: callers decide when to run `sync`.
