export interface ListLine {
  readonly indent: number
  readonly ordered: boolean
  readonly number: number | null
  readonly checkbox: boolean | null
  readonly from: number
}

const LIST = /^([ \t]*)(?:([*+])|(\d+)\.)[ \t]+(?:\[([ xX])\][ \t]+)?/u

export const listLine = (line: string): ListLine | null => {
  const match = LIST.exec(line)

  if (match === null) {
    return null
  }

  const [whole, indent = "", , number, checkbox] = match

  return {
    indent: indent.length,
    ordered: number !== undefined,
    number: number === undefined ? null : Number(number),
    checkbox: checkbox === undefined ? null : checkbox !== " ",
    from: whole.length,
  }
}

const TABLE = /^[ \t]*\|.*\|[ \t]*$/u
const SEPARATOR = /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?[ \t]*)?$/u

export const isTableRow = (line: string) => TABLE.test(line)

export const isTableSeparator = (line: string) => SEPARATOR.test(line)

export const tableCells = (
  line: string,
): ReadonlyArray<{ readonly from: number; readonly to: number }> => {
  const cells: Array<{ from: number; to: number }> = []
  const open = line.indexOf("|")
  const close = line.lastIndexOf("|")
  let from = open + 1

  for (let at = from; at <= close; at++) {
    if (at === close || (line[at] === "|" && line[at - 1] !== "\\")) {
      const text = line.slice(from, at)
      const start = from + (text.length - text.trimStart().length)
      cells.push({ from: start, to: Math.max(start, from + text.trimEnd().length) })
      from = at + 1
    }
  }

  return cells
}

export const isRule = (line: string) => /^[ \t]*-{3,}[ \t]*$/u.test(line)
