import type { Props } from "@seqno/domain"
import type { Outline, OutlineBlock } from "./outline.ts"

const HEADING = /^(\*+)(?: (.*))?$/
const DIRECTIVE = /^#\+([^:\s][^:]*):(.*)$/
const DRAWER_LINE = /^:([^:\s]+):(.*)$/
const PLANNING = /^\s*(SCHEDULED|DEADLINE):/
const BEGIN = /^\s*#\+BEGIN_(\S+)/i

interface Open {
  readonly level: number
  readonly lines: string[]
  readonly children: Open[]
}

const filled = (line: string) => line.trim() !== ""

const trimmed = (lines: readonly string[]) =>
  lines.slice(lines.findIndex(filled), lines.findLastIndex(filled) + 1)

const drawerAt = (lines: readonly string[], from: number) => {
  if (lines[from]?.trim().toUpperCase() !== ":PROPERTIES:") {
    return null
  }

  const end = lines.findIndex((line, at) => at > from && line.trim().toUpperCase() === ":END:")

  if (end === -1) {
    return null
  }

  const props: Record<string, string> = {}

  for (const line of lines.slice(from + 1, end)) {
    const match = DRAWER_LINE.exec(line.trim())

    if (match === null) {
      return null
    }

    props[match[1] ?? ""] = (match[2] ?? "").trim()
  }

  return { props, end }
}

const blockOf = (open: Open): OutlineBlock => {
  const lines = open.lines
  let at = 1

  while (at < lines.length && PLANNING.test(lines[at] ?? "")) {
    at++
  }

  const drawer = drawerAt(lines, at)
  const { collapsed, ...props } = drawer?.props ?? {}
  const body = drawer === null ? lines : [...lines.slice(0, at), ...lines.slice(drawer.end + 1)]
  const [head = "", ...rest] = body

  return {
    text: [head, ...rest.slice(0, rest.findLastIndex(filled) + 1)].join("\n"),
    props,
    collapsed: collapsed === "true",
    children: open.children.map(blockOf),
  }
}

const pagePropsOf = (preamble: readonly string[]) => {
  const directives: Record<string, string> = {}
  const text: string[] = []

  for (const line of preamble) {
    const match = DIRECTIVE.exec(line)

    if (match === null) {
      text.push(line)
    } else {
      directives[match[1] ?? ""] = (match[2] ?? "").trim()
    }
  }

  if (Object.keys(directives).length > 0) {
    return { props: directives, text }
  }

  const first = text.findIndex(filled)
  const drawer = first === -1 ? null : drawerAt(text, first)

  return drawer === null
    ? { props: {}, text }
    : { props: drawer.props, text: text.slice(drawer.end + 1) }
}

export const parseOrg = (
  source: string,
  frontMatter: (preamble: readonly string[]) => Outline | null,
): Outline => {
  const lines = source.replaceAll("\r\n", "\n").split("\n")
  const preamble: string[] = []
  const roots: Open[] = []
  const stack: Open[] = []
  let verbatim: string | null = null

  for (const line of lines) {
    const heading = verbatim === null ? HEADING.exec(line) : null

    if (heading === null) {
      const begin = BEGIN.exec(line)?.[1]

      if (verbatim === null && begin !== undefined) {
        verbatim = `#+END_${begin.toUpperCase()}`
      } else if (verbatim !== null && line.trim().toUpperCase().startsWith(verbatim)) {
        verbatim = null
      }

      const current = stack.at(-1)

      if (current === undefined) {
        preamble.push(line)
      } else {
        current.lines.push(line)
      }

      continue
    }

    const level = heading[1]?.length ?? 1

    while ((stack.at(-1)?.level ?? 0) >= level) {
      stack.pop()
    }

    const node: Open = { level, lines: [heading[2] ?? ""], children: [] }
    const parent = stack.at(-1)

    if (parent === undefined) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }

    stack.push(node)
  }

  const blocks = roots.map(blockOf)
  const front = frontMatter(preamble)

  if (front !== null) {
    return { ...front, blocks: [...front.blocks, ...blocks] }
  }

  const page = pagePropsOf(preamble)
  const text = trimmed(page.text)

  const first: readonly OutlineBlock[] =
    text.length === 0 ? [] : [{ text: text.join("\n"), props: {}, collapsed: false, children: [] }]

  return { props: page.props, blocks: [...first, ...blocks] }
}

const drawerLines = (props: Props, collapsed: boolean): readonly string[] => {
  const entries = [...Object.entries(props), ...(collapsed ? [["collapsed", "true"]] : [])]

  return entries.length === 0
    ? []
    : [":PROPERTIES:", ...entries.map(([key, value]) => `:${key}: ${value}`), ":END:"]
}

const orgLines = (block: OutlineBlock, level: number): readonly string[] => {
  const [head = "", ...rest] = block.text.split("\n")
  const planned = rest.findIndex((line) => !PLANNING.test(line))
  const planning = planned === -1 ? rest : rest.slice(0, planned)
  const body = planned === -1 ? [] : rest.slice(planned)
  const stars = "*".repeat(level)

  return [
    head === "" ? stars : `${stars} ${head}`,
    ...planning,
    ...drawerLines(block.props, block.collapsed),
    ...body,
    ...block.children.flatMap((child) => orgLines(child, level + 1)),
  ]
}

export const printOrg = (outline: Outline, frontMatter: (props: Props) => readonly string[]) => {
  const props =
    outline.frontMatter === true
      ? frontMatter(outline.props)
      : Object.entries(outline.props).map(([key, value]) => `#+${key}: ${value}`)

  const blocks = outline.blocks.flatMap((block) => orgLines(block, 1))

  return [...props, ...(props.length > 0 && blocks.length > 0 ? [""] : []), ...blocks].join("\n")
}
