export interface Size {
  readonly years: number
  readonly density: number
}

export const size: Size = {
  years: Number(process.env["SEQNO_BENCH_YEARS"] ?? 10),
  density: Number(process.env["SEQNO_BENCH_DENSITY"] ?? 1),
}

export const yearsOf = ({ years, density }: Size) =>
  density === 1 ? `${years} years` : `${years} years at ${density}× the blocks a day`
