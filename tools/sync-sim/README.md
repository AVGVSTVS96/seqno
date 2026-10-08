# @seqno/sync-sim

A tool: a seeded simulator where several devices edit one graph through a hostile fake iCloud for 12 to 48 simulated hours, then must all match an oracle with no lost ops.

## What's inside

| Path                                     | What it holds                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cloud.ts`                           | `FakeICloud`: per-device folder views, late and out-of-order delivery, placeholders, eviction, failed downloads, conflict copies, offline devices, skewed clocks.                                    |
| `src/ports.ts`                           | The swap points: `Graphs` opens a `Replica`, `Vaults` attaches a vault to a replica and the cloud.                                                                                                   |
| `src/loro-graph.ts`, `src/loro-vault.ts` | Stand-in graph and vault on Loro. The vault has switchable `bugs` for mutant runs.                                                                                                                   |
| `src/real-vault.ts`                      | A `Vaults` layer over the real `@seqno/vault` (`--vault real`).                                                                                                                                      |
| `src/sim.ts`, `src/workload.ts`          | `runSeed(config)`: a workload of domain `Command`s, then checks for lost ops, divergence, unsound acks, two writers on one file, placeholder reads, and a fresh device bootstrapping from the cloud. |
| `scripts/run.ts`, `scripts/mutants.ts`   | Run a suite (`ci`, `1k`, `10k`) with one process per seed, or check that every mutant gets caught.                                                                                                   |

Time and randomness come only from Effect's `Clock` and `Crypto`, so the same seed replays the same run.

## Tests

```sh
pnpm test --project @seqno/sync-sim
```

Longer runs: `pnpm --filter @seqno/sync-sim sim --suite ci --vault real` and `pnpm --filter @seqno/sync-sim mutants`.

## Known gaps

- The sim still runs its stand-in graph: the checks need reads the real `@seqno/graph` doesn't expose, such as `fate(id)` and a canonical dump.
- The stand-in graph rejects `SplitBlock`, `MergeWithPrevious`, `Indent`, `Outdent`, `Undo` and `Redo`, so the workload never uses them.
- Mutants run against the stand-in vault only; the real vault has no bug switches.
