export const propertyKey = (key: string): string => key.toLowerCase().replaceAll(/[ _]/gu, "-")

export type PropertyLine = readonly [key: string, value: string]

export interface PropertyDraft {
  readonly text: string
  readonly props: readonly PropertyLine[]
  readonly runFrom: number
  readonly runTo: number
}

export type PropertyStyle = "markdown" | "org" | "frontMatter" | "directives"

interface StyleRules {
  readonly line: RegExp
  readonly print: (key: string, value: string) => string
  readonly open?: string
  readonly close?: string
}

const styles: Record<PropertyStyle, StyleRules> = {
  markdown: { line: /^([^\s:]+):: (.*)$/u, print: (key, value) => `${key}:: ${value}` },
  org: {
    line: /^:([^\s:]+): ?(.*)$/u,
    print: (key, value) => `:${key}: ${value}`,
    open: ":PROPERTIES:",
    close: ":END:",
  },
  frontMatter: {
    line: /^([^:]+):[ \t]*(.*)$/u,
    print: (key, value) => `${key}: ${value}`,
    open: "---",
    close: "---",
  },
  directives: {
    line: /^#\+([^:\s][^:]*):[ \t]*(.*)$/u,
    print: (key, value) => `#+${key}: ${value}`,
  },
}

export const propertyLineOf = (text: string, style: PropertyStyle): PropertyLine | null => {
  const { line, open, close } = styles[style]

  if (text === open || text === close) {
    return null
  }

  const match = line.exec(text)

  return match === null ? null : [match[1] ?? "", match[2] ?? ""]
}

const verbatim = /^\s*(```|~~~|#\+BEGIN_)/iu

const runOf = (lines: readonly string[], style: PropertyStyle): readonly PropertyLine[] => {
  const rules = styles[style]
  const props: PropertyLine[] = []

  for (const text of lines) {
    if (text.toUpperCase() === rules.close?.toUpperCase()) {
      break
    }

    const match = rules.line.exec(text)
    const key = match?.[1]
    const value = match?.[2]

    if (key === undefined || value === undefined || /^\d+$/u.test(key)) {
      break
    }

    if (props.some(([seen]) => seen === key)) {
      break
    }

    props.push([key, value])
  }

  return props
}

const length = (lines: readonly string[]) => lines.reduce((sum, text) => sum + text.length + 1, 0)

const runLength = (lines: readonly string[], style: PropertyStyle) => {
  const { open, close } = styles[style]

  if (open === undefined) {
    const props = runOf(lines, style)

    return { props, size: props.length }
  }

  if (lines[0]?.toUpperCase() !== open.toUpperCase()) {
    return { props: [], size: 0 }
  }

  const props = runOf(lines.slice(1), style)
  const closed = lines[props.length + 1]?.toUpperCase() === close?.toUpperCase()

  return closed && props.length > 0 ? { props, size: props.length + 2 } : { props: [], size: 0 }
}

export const splitProperties = (
  draft: string,
  style: PropertyStyle = "markdown",
): PropertyDraft => {
  const lines = draft.split("\n")
  const [head = "", ...rest] = lines
  const whole = runLength(lines, style)

  if (head !== "" && whole.size === lines.length) {
    return { text: "", props: whole.props, runFrom: 0, runTo: draft.length }
  }

  const run = verbatim.test(head) ? { props: [], size: 0 } : runLength(rest, style)
  const body = rest.slice(run.size)
  const runFrom = head.length

  return {
    text: [head, ...body].join("\n"),
    props: run.props,
    runFrom,
    runTo: runFrom + length(rest.slice(0, run.size)),
  }
}

export const joinProperties = (
  text: string,
  props: readonly PropertyLine[],
  style: PropertyStyle = "markdown",
): string => {
  const { print, open, close } = styles[style]
  const printed = props.map(([key, value]) => print(key, value))

  if (printed.length === 0) {
    return text
  }

  const lines = open === undefined ? printed : [open, ...printed, close ?? open]

  if (text === "") {
    return lines.join("\n")
  }

  const [head = "", ...body] = text.split("\n")

  return [head, ...lines, ...body].join("\n")
}

export const draftOffset = (
  text: string,
  props: readonly PropertyLine[],
  offset: number,
  style: PropertyStyle = "markdown",
) => {
  if (props.length === 0) {
    return offset
  }

  if (text === "") {
    return joinProperties(text, props, style).length
  }

  const head = text.split("\n")[0] ?? ""

  return offset <= head.length
    ? offset
    : offset + joinProperties(head, props, style).length - head.length
}

export const textOffset = (draft: PropertyDraft, offset: number) =>
  offset <= draft.runFrom
    ? offset
    : offset < draft.runTo
      ? draft.runFrom
      : offset - (draft.runTo - draft.runFrom)
