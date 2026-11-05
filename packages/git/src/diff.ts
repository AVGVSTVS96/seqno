import { structuredPatch } from "diff"
import { short } from "./format.ts"

export interface Side {
  readonly oid: string
  readonly bytes: Uint8Array
}

export interface Change {
  readonly path: string
  readonly before: Side | null
  readonly after: Side | null
}

const zeros = "0000000"

const binary = (bytes: Uint8Array) => bytes.subarray(0, 8000).includes(0)

const range = (start: number, lines: number) =>
  lines === 1 ? `${start}` : `${lines === 0 ? start - 1 : start},${lines}`

const hunks = (before: string, after: string) =>
  structuredPatch("", "", before, after, "", "", { context: 3 }).hunks.map((hunk) =>
    [
      `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@`,
      ...hunk.lines,
    ].join("\n"),
  )

const decoder = new TextDecoder()

const named = (name: string) => (name.includes(" ") && !name.startsWith('"') ? `${name}\t` : name)

export const patch = ({ path, before, after }: Change, quote: (path: string) => string) => {
  const a = quote(`a/${path}`)
  const b = quote(`b/${path}`)
  const head = [`diff --git ${a} ${b}`]

  if (before === null) {
    head.push("new file mode 100644")
  }

  if (after === null) {
    head.push("deleted file mode 100644")
  }

  const index = `index ${before === null ? zeros : short(before.oid)}..${after === null ? zeros : short(after.oid)}`
  head.push(before !== null && after !== null ? `${index} 100644` : index)
  const old = before?.bytes ?? new Uint8Array()
  const next = after?.bytes ?? new Uint8Array()

  if (binary(old) || binary(next)) {
    head.push(
      `Binary files ${before === null ? "/dev/null" : a} and ${after === null ? "/dev/null" : b} differ`,
    )

    return `${head.join("\n")}\n`
  }

  const body = hunks(decoder.decode(old), decoder.decode(next))

  if (body.length === 0) {
    return `${head.join("\n")}\n`
  }

  head.push(
    before === null ? "--- /dev/null" : `--- ${named(a)}`,
    after === null ? "+++ /dev/null" : `+++ ${named(b)}`,
  )

  return `${[...head, ...body].join("\n")}\n`
}
