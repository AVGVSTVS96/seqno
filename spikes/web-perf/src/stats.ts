const round = (ms: number) => Math.round(ms * 1000) / 1000

export const summarize = (values: readonly number[]) => {
  const sorted = Float64Array.from(values).sort()
  const at = (q: number) => round(sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!)
  return {
    n: sorted.length,
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  }
}

export const median = (values: readonly number[]) => summarize(values).p50
