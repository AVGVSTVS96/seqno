export type PropertyLine = readonly [key: string, value: string]

export interface PropertyDraft {
  readonly text: string
  readonly props: ReadonlyArray<PropertyLine>
  readonly runFrom: number
  readonly runTo: number
}

const line = /^([^\s:]+):: (.*)$/
const verbatim = /^\s*(```|~~~|#\+BEGIN_)/i

const runOf = (lines: ReadonlyArray<string>): ReadonlyArray<PropertyLine> => {
  const props: Array<PropertyLine> = []
  for (const text of lines) {
    const match = line.exec(text)
    const key = match?.[1]
    const value = match?.[2]
    if (key === undefined || value === undefined || /^\d+$/.test(key)) break
    if (props.some(([seen]) => seen === key)) break
    props.push([key, value])
  }
  return props
}

const length = (lines: ReadonlyArray<string>) =>
  lines.reduce((sum, text) => sum + text.length + 1, 0)

export const splitProperties = (draft: string): PropertyDraft => {
  const lines = draft.split("\n")
  const [head = "", ...rest] = lines
  const whole = runOf(lines)
  if (head !== "" && whole.length === lines.length) {
    return { text: "", props: whole, runFrom: 0, runTo: draft.length }
  }
  const props = verbatim.test(head) ? [] : runOf(rest)
  const body = rest.slice(props.length)
  const runFrom = head.length
  return {
    text: [head, ...body].join("\n"),
    props,
    runFrom,
    runTo: runFrom + length(rest.slice(0, props.length)),
  }
}

export const joinProperties = (text: string, props: ReadonlyArray<PropertyLine>): string => {
  const lines = props.map(([key, value]) => `${key}:: ${value}`)
  if (lines.length === 0) return text
  if (text === "") return lines.join("\n")
  const [head = "", ...body] = text.split("\n")
  return [head, ...lines, ...body].join("\n")
}

export const draftOffset = (text: string, props: ReadonlyArray<PropertyLine>, offset: number) => {
  if (props.length === 0) return offset
  if (text === "") return joinProperties(text, props).length
  const head = text.split("\n")[0] ?? ""
  return offset <= head.length
    ? offset
    : offset + props.reduce((sum, [key, value]) => sum + key.length + value.length + 4, 0)
}

export const textOffset = (draft: PropertyDraft, offset: number) =>
  offset <= draft.runFrom
    ? offset
    : offset < draft.runTo
      ? draft.runFrom
      : offset - (draft.runTo - draft.runFrom)
