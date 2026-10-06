import type { SeedResult, Violations } from "./sim.ts"

export type Finished = SeedResult & { readonly rssMB: number }

const sum = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0)

const pct = (xs: ReadonlyArray<number>, p: number) => {
  const sorted = xs.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

const minutes = (ms: number) => Number((ms / 60_000).toFixed(1))

const mean = (xs: ReadonlyArray<number>) => (xs.length === 0 ? 0 : Math.round(sum(xs) / xs.length))

const violationKeys: ReadonlyArray<keyof Violations> = [
  "lostCoverage",
  "ackUnsound",
  "multiWriter",
  "placeholderRead",
  "diverged",
  "lostOps",
  "bootstrap",
  "noConvergence",
]

export const summarize = (
  config: object,
  results: ReadonlyArray<Finished>,
  crashes: ReadonlyArray<{ readonly seed: number; readonly crash: string }>,
  wallS: number,
) => {
  const failed = results.filter((r) => !r.ok)
  const catchUps = results.flatMap((r) => r.catchUps.filter((c) => !c.interrupted))
  const converge = results.map((r) => r.quiescenceToConvergeMs)
  return {
    config,
    seeds: results.length + crashes.length,
    passed: results.length - failed.length,
    crashed: crashes,
    failed: failed.slice(0, 20).map((r) => ({ seed: r.seed, problems: r.problems.slice(0, 4) })),
    violations: Object.fromEntries(
      violationKeys.map((key) => [key, sum(results.map((r) => r.violations[key]))]),
    ),
    convergenceAfterQuiescenceMin: {
      p50: minutes(pct(converge, 0.5)),
      p99: minutes(pct(converge, 0.99)),
      max: minutes(Math.max(0, ...converge)),
    },
    catchUpAfterLongOffline: {
      events: catchUps.length,
      neverCaughtUp: catchUps.filter((c) => c.catchUpMs < 0).length,
      catchUpMin: {
        p50: minutes(pct(catchUps.map((c) => c.catchUpMs), 0.5)),
        p99: minutes(pct(catchUps.map((c) => c.catchUpMs), 0.99)),
        max: minutes(Math.max(0, ...catchUps.map((c) => c.catchUpMs))),
      },
      othersSeeItsOfflineEditsMin: {
        p50: minutes(pct(catchUps.map((c) => c.publishMs), 0.5)),
        max: minutes(Math.max(0, ...catchUps.map((c) => c.publishMs))),
      },
    },
    cloudFiles: {
      peakCount: { mean: mean(results.map((r) => r.files.peakCount)), max: Math.max(0, ...results.map((r) => r.files.peakCount)) },
      finalCount: { mean: mean(results.map((r) => r.files.finalCount)), max: Math.max(0, ...results.map((r) => r.files.finalCount)) },
      finalBytes: { mean: mean(results.map((r) => r.files.finalBytes)), max: Math.max(0, ...results.map((r) => r.files.finalBytes)) },
      snapshotsWritten: sum(results.map((r) => r.snapshotsWritten)),
      sameSnapshotFromTwoDevices: sum(results.map((r) => r.sameSnapshotFromTwoDevices)),
    },
    placeholders: {
      seenByVaults: sum(results.map((r) => r.vaults.placeholdersSeen)),
      readAsData: sum(results.map((r) => r.cloud.datalessReads + r.cloud.stubReads)),
      evictions: sum(results.map((r) => r.cloud.evictions)),
      conflictCopies: sum(results.map((r) => r.cloud.conflictCopies)),
      downloadFailures: sum(results.map((r) => r.cloud.downloadFailures)),
    },
    ops: {
      perSeedMean: mean(results.map((r) => sum(Object.values(r.ops)) - r.ops.rejected - r.ops.cyclePairs)),
      rejected: sum(results.map((r) => r.ops.rejected)),
      cyclePairs: sum(results.map((r) => r.ops.cyclePairs)),
    },
    cpu: {
      meanSeedMs: mean(results.map((r) => r.cpuMs)),
      wallS: Number(wallS.toFixed(1)),
      maxSeedRssMB: Math.max(0, ...results.map((r) => r.rssMB)),
    },
  }
}
