# @seqno/sync-sim

A tool: a seeded simulator where several devices edit one graph through a hostile fake iCloud for 12 to 48 simulated hours, then must all match an oracle with no lost ops.

## What's inside

| Path                                     | What it holds                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cloud.ts`                           | `FakeICloud`: per-device folder views, late and out-of-order delivery, placeholders, eviction, failed downloads, conflict copies, offline devices, skewed clocks.                                                                                                                                                |
| `src/ports.ts`                           | The swap points: `Graphs` opens a `Replica`, `Vaults` attaches a vault to a replica and the cloud.                                                                                                                                                                                                               |
| `src/loro-graph.ts`, `src/loro-vault.ts` | Stand-in graph and vault on Loro. The vault has switchable `bugs` for mutant runs.                                                                                                                                                                                                                               |
| `src/real-vault.ts`                      | A `Vaults` layer over the real `@seqno/vault` (`--vault real`). Like the app, it saves after every sync pass, and devices restart: each one closes its graph now and then and reopens from its local files with a new peer id.                                                                                   |
| `src/real-graph.ts`                      | A `Graphs` layer over the real `@seqno/graph` (`--graph real`, which implies the real vault). The workload then also sends `SplitBlock`, `MergeWithPrevious`, `Indent`, `Outdent`, `Undo`, `Redo` and creates pages under shared names. An empty graph takes its first files through `restore`, as the app does. |
| `src/sim.ts`, `src/workload.ts`          | `runSeed(config)`: a workload of domain `Command`s, then checks for lost ops, divergence, unsound acks, two writers on one file, placeholder reads, and a fresh device bootstrapping from the cloud.                                                                                                             |
| `scripts/run.ts`, `scripts/mutants.ts`   | Run a suite (`ci`, `1k`, `10k`) with one process per seed, or check that every mutant gets caught.                                                                                                                                                                                                               |

Time and randomness come only from Effect's `Clock` and `Crypto`, so the same seed replays the same run.

## Tests

```sh
pnpm test --project @seqno/sync-sim
```

CI also runs the tree-per-page suite, 50 seeds of 600 ops: `pnpm --filter @seqno/sync-sim sim --suite ci --graph pages`.

Longer runs: `pnpm --filter @seqno/sync-sim sim --suite ci --graph real` (or `--vault real` for the stand-in graph on the real vault) and `pnpm --filter @seqno/sync-sim mutants`.

## Known gaps

- With the real graph, the per-token intent check is off: merges, splits and undo move and remove text in ways the token bookkeeping can't follow. Those runs are checked by op coverage (every op any session made reaches the oracle and every device), identical final pages and outlines on every device and on a fresh device that reads only the cloud, no two live pages with one name, and no block id twice.
- `ackUnsound` compares deletions with the most each device has ever merged, across its restarts: a restarted device starts empty and catches up from the cloud, so its in-memory version can drop below what its `seen` file already promised.
- The fresh-device check hands every cloud file to one merge in listing order. That is stricter than the app, whose vault merges the newest snapshot first, and it is how the sim found Loro leaving an update unapplied when the snapshot it builds on came later.
- A 10k-op seed on the real graph takes about 5 CPU minutes and up to 0.9 GB. The 10k runs used `--heap-mb 2048` for headroom (the default heap is 1 GB).
- Result on the real graph: 20 seeds of 10k ops (seeds 1 to 20) all converged with no violations, at most 940 MB per seed. The 1,000-run 10k suite was stopped there on purpose: large-graph open and scroll speed matter more.
- Restarts are clean (the device saves first); a crash that loses unsaved ops isn't simulated.
- Mutants run against the stand-in vault only; the real vault has no bug switches.
