import { markdownOf, type Inlines } from "./inline.ts"
import { upToLevel, type Item, type PropertyLine } from "./items.ts"

export type IndentStyle = "dashes" | "spaces" | "no-indent"

export interface TextOptions {
  readonly indent: IndentStyle
  readonly properties: boolean
  readonly newlineAfterBlock: boolean
  readonly level: number | null
}

const dedent = (lines: ReadonlyArray<string>) => {
  const widths = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length)
  const common = widths.length === 0 ? 0 : Math.min(...widths)
  return lines.map((line) => line.slice(Math.min(common, line.length - line.trimStart().length)))
}

const propertyLine = ([key, value]: PropertyLine) =>
  value === "" ? `${key}::` : `${key}:: ${value}`

export const pagePreamble = (props: ReadonlyArray<PropertyLine>, options: TextOptions) =>
  !options.properties || props.length === 0 ? [] : [...props.map(propertyLine), ""]

export const textOf = (
  items: ReadonlyArray<Item>,
  inlines: Inlines,
  options: TextOptions,
  preamble: ReadonlyArray<string> = [],
): string => {
  const flat = options.indent === "no-indent"
  const out: Array<string> = [...preamble]
  let headings = 0
  let bullet: string | null = null
  const push = (line: string) => {
    if (bullet !== null) out.push(line === "" ? bullet.trimEnd() : bullet + line.trimStart())
    else out.push(line)
    bullet = null
  }
  for (const item of upToLevel(items, options.level)) {
    const tabs = flat ? "" : "\t".repeat(item.level - 1)
    const body = (line: string) =>
      push(flat ? line.trimStart() : line === "" ? "" : `${tabs}  ${line}`)
    switch (item._tag) {
      case "Heading": {
        const title = item.prefix + markdownOf(item.title, inlines)
        if (bullet !== null) push("")
        if (options.newlineAfterBlock && headings > 0) out.push("")
        headings++
        if (!flat && item.untitled) {
          if (options.indent === "dashes") out.push(`${tabs}-`)
          else bullet = tabs
        } else if (flat) {
          if (title.trim() !== "") out.push(title.trim())
        } else if (options.indent === "dashes") {
          out.push(title === "" ? `${tabs}-` : `${tabs}- ${title}`)
        } else {
          out.push(`${tabs}${title}`)
        }
        break
      }
      case "Properties":
        if (options.properties) item.props.forEach((prop) => body(propertyLine(prop)))
        break
      case "Paragraph":
        item.lines.forEach((line) => body(markdownOf(line, inlines)))
        break
      case "Quote":
        item.lines.forEach((line) => body(`> ${markdownOf(line, inlines)}`))
        break
      case "Code":
        if (flat) dedent(item.lines).forEach(push)
        else item.lines.forEach(body)
        break
      case "Raw":
        item.lines.forEach(body)
        break
    }
  }
  if (bullet !== null) push("")
  return out.length === 0 ? "" : `${out.join("\n")}\n`
}
