export type Edit =
  | { readonly _tag: "Same"; readonly a: number; readonly b: number }
  | { readonly _tag: "Removed"; readonly a: number }
  | { readonly _tag: "Added"; readonly b: number }

const myers = (
  same: (a: number, b: number) => boolean,
  start: number,
  n: number,
  m: number,
): readonly Edit[] => {
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  const at = (row: Int32Array, k: number) => row[offset + k] ?? 0

  const goesDown = (row: Int32Array, k: number, d: number) =>
    k === -d || (k !== d && at(row, k - 1) < at(row, k + 1))

  const reachesEnd = (d: number) => {
    for (let k = -d; k <= d; k += 2) {
      let x = goesDown(v, k, d) ? at(v, k + 1) : at(v, k - 1) + 1
      let y = x - k

      while (x < n && y < m && same(start + x, start + y)) {
        x++
        y++
      }

      v[offset + k] = x

      if (x >= n && y >= m) {
        return true
      }
    }

    return false
  }

  for (let d = 0; d <= max; d++) {
    trace.push(new Int32Array(v))

    if (reachesEnd(d)) {
      break
    }
  }

  const edits: Edit[] = []
  let x = n
  let y = m

  for (let d = trace.length - 1; d >= 0; d--) {
    const row = trace[d] ?? v
    const k = x - y
    const down = goesDown(row, k, d)
    const prevK = down ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : at(row, prevK)
    const prevY = d === 0 ? 0 : prevX - prevK

    while (x > prevX && y > prevY) {
      x--
      y--
      edits.push({ _tag: "Same", a: start + x, b: start + y })
    }

    if (d === 0) {
      break
    }

    if (down) {
      y--
      edits.push({ _tag: "Added", b: start + y })
    } else {
      x--
      edits.push({ _tag: "Removed", a: start + x })
    }
  }

  return edits.toReversed()
}

export const diffWith = (
  lengthA: number,
  lengthB: number,
  same: (a: number, b: number) => boolean,
): readonly Edit[] => {
  let start = 0

  while (start < lengthA && start < lengthB && same(start, start)) {
    start++
  }

  let endA = lengthA
  let endB = lengthB

  while (endA > start && endB > start && same(endA - 1, endB - 1)) {
    endA--
    endB--
  }

  const head = Array.from({ length: start }, (_, at): Edit => ({ _tag: "Same", a: at, b: at }))

  const tail = Array.from({ length: lengthA - endA }, (_, at): Edit => ({
    _tag: "Same",
    a: endA + at,
    b: endB + at,
  }))

  return [...head, ...myers(same, start, endA - start, endB - start), ...tail]
}

export const diff = (a: readonly string[], b: readonly string[]): readonly Edit[] =>
  diffWith(a.length, b.length, (x, y) => a[x] === b[y])

export const likeness = (a: string, b: string): number => {
  if (a === b) {
    return 1
  }

  const longest = Math.max(a.length, b.length)
  let prefix = 0

  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++
  }

  let suffix = 0

  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }

  return (prefix + suffix) / longest
}

const largestAlignment = 250_000

export const align = (
  lengthA: number,
  lengthB: number,
  score: (a: number, b: number) => number,
): ReadonlyArray<readonly [number, number]> => {
  if (lengthA * lengthB > largestAlignment) {
    return Array.from({ length: Math.min(lengthA, lengthB) }, (_, at) => [at, at] as const)
  }

  const width = lengthB + 1
  const best = new Float64Array((lengthA + 1) * width)

  for (let a = 1; a <= lengthA; a++) {
    for (let b = 1; b <= lengthB; b++) {
      const here = score(a - 1, b - 1)
      const diagonal = here >= 0.5 ? (best[(a - 1) * width + b - 1] ?? 0) + here : -1
      best[a * width + b] = Math.max(
        best[(a - 1) * width + b] ?? 0,
        best[a * width + b - 1] ?? 0,
        diagonal,
      )
    }
  }

  const pairs: Array<readonly [number, number]> = []
  let a = lengthA
  let b = lengthB

  while (a > 0 && b > 0) {
    const here = best[a * width + b] ?? 0

    if (here === (best[(a - 1) * width + b] ?? 0)) {
      a--
    } else if (here === (best[a * width + b - 1] ?? 0)) {
      b--
    } else {
      pairs.push([a - 1, b - 1])
      a--
      b--
    }
  }

  return pairs.toReversed()
}

interface Hunk {
  readonly from: number
  readonly to: number
  readonly insert: string
}

const hunksOf = (base: readonly string[], other: readonly string[]) => {
  const out: Hunk[] = []
  let open: { from: number; insert: string } | null = null
  let position = 0

  const close = () => {
    if (open !== null) {
      out.push({ from: open.from, to: position, insert: open.insert })
    }

    open = null
  }

  for (const edit of diff(base, other)) {
    if (edit._tag === "Same") {
      close()
      position = edit.a + 1
    } else if (edit._tag === "Removed") {
      open ??= { from: edit.a, insert: "" }
      position = edit.a + 1
    } else {
      open ??= { from: position, insert: "" }
      open.insert += other[edit.b] ?? ""
    }
  }

  close()

  return out
}

const characters = (text: string): readonly string[] => {
  const points: string[] = []

  for (const point of text) {
    points.push(point)
  }

  return points
}

const touches = (hunk: Hunk, from: number, to: number) =>
  (hunk.from < to && hunk.to > from) ||
  hunk.from === from ||
  (hunk.from === hunk.to && hunk.from > from && hunk.from < to)

export const merge3Text = (base: string, disk: string, page: string): string => {
  if (page === base || disk === page) {
    return disk
  }

  if (disk === base) {
    return page
  }

  const points = characters(base)
  const fromDisk = hunksOf(points, characters(disk))
  const fromPage = hunksOf(points, characters(page))
  const out: string[] = []
  let position = 0
  let d = 0
  let p = 0

  while (d < fromDisk.length || p < fromPage.length) {
    const nextDisk = fromDisk[d]
    const nextPage = fromPage[p]

    const first =
      nextPage === undefined ||
      (nextDisk !== undefined &&
        (nextDisk.from < nextPage.from ||
          (nextDisk.from === nextPage.from && nextDisk.to <= nextPage.to)))
        ? nextDisk
        : nextPage

    if (first === undefined) {
      break
    }

    const span = { from: first.from, to: first.to }
    const disks: Hunk[] = []
    const pages: Hunk[] = []
    let grew = true

    while (grew) {
      grew = false
      const candidateDisk = fromDisk[d]

      if (candidateDisk !== undefined && touches(candidateDisk, span.from, span.to)) {
        disks.push(candidateDisk)
        span.to = Math.max(span.to, candidateDisk.to)
        d++
        grew = true
      }

      const candidatePage = fromPage[p]

      if (candidatePage !== undefined && touches(candidatePage, span.from, span.to)) {
        pages.push(candidatePage)
        span.to = Math.max(span.to, candidatePage.to)
        p++
        grew = true
      }
    }

    const rebuilt = (side: readonly Hunk[]) => {
      let text = ""
      let at = span.from

      for (const hunk of side) {
        text += points.slice(at, hunk.from).join("") + hunk.insert
        at = hunk.to
      }

      return text + points.slice(at, span.to).join("")
    }

    const diskText = rebuilt(disks)
    const pageText = rebuilt(pages)
    const inserts = span.from === span.to
    out.push(
      points.slice(position, span.from).join(""),
      pages.length === 0
        ? diskText
        : disks.length === 0
          ? pageText
          : diskText === pageText
            ? diskText
            : inserts
              ? diskText + pageText
              : diskText,
    )
    position = span.to
  }

  out.push(points.slice(position).join(""))

  return out.join("")
}

export const textEdit = (from: string, to: string) => {
  let start = 0

  while (start < from.length && start < to.length && from[start] === to[start]) {
    start++
  }

  let end = 0

  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  ) {
    end++
  }

  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) }
}
