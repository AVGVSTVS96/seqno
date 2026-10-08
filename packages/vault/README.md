# @seqno/vault

The core side's edit-log files in a synced folder: each device's Loro update files, snapshots and `seen` acks, plus the rule for when it is safe to compact and delete.

## What's inside

| Export                                                  | What it does                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Vault`, `layer(config)`                                | `writeUpdate(bytes)` saves one update file named by its op counter. `sync(replica)` lists, downloads, merges, acks, compacts and deletes in one pass. |
| `Replica`, `loroReplica(doc)`                           | The port a graph implements (`version`, `merge`, `snapshot`). `@seqno/graph`'s `vaultReplica` is the real one.                                        |
| `Storage`                                               | The file adapter port: `list`, `read`, `write` (atomic), `remove`, `download`.                                                                        |
| `layerOpfs`, `layerDirectoryHandle`, `directoryStorage` | Browser adapters for OPFS and for a folder picked with the File System Access API.                                                                    |
| `@seqno/vault/node`                                     | `nodeStorage` and `layerNode` on `node:fs`: temp file, `datasync`, rename.                                                                            |
| `makeFakeCloud`                                         | A fake iCloud for tests: per-device views, late and out-of-order delivery, placeholders, eviction, conflict copies.                                   |
| `updatePath`, `snapshotPath`, `seenPath`                | The layout: `updates/<device>/<n>.loro`, `snapshots/<hash>.loro`, `seen/<device>.json`.                                                               |

- A device deletes only its own files. An update file goes once every member's `seen` covers it and another device has confirmed a covering snapshot.
- A file that isn't downloaded is never read as empty: it has to pass Loro's checksum, or it waits for the next pass.

## Tests

The browser tests drive headless Google Chrome, so it has to be installed.

```sh
pnpm test --project @seqno/vault
```

## Known gaps

- Members are whatever the caller passes. The web app passes only its own device; where a shared member list lives is still open.
- A file that stays corrupt sits in `waiting` forever and holds back compaction on every device.
- Reading an evicted iCloud file from Chrome is unmeasured, and the picked-folder adapter can only request a download by reading.
