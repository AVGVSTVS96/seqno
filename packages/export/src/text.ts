import { markdownOf } from "./inline.ts"
import type { Inlines } from "./inline.ts"
import { upToLevel } from "./items.ts"
import type { Item, ListItem, PropertyLine, Run } from "./items.ts"

export type IndentStyle = "dashes" | "spaces" | "no-indent"

export interface TextOptions {
  readonly indent: IndentStyle
  readonly properties: boolean
  readonly newlineAfterBlock: boolean
  readonly level: number | null
}

interface Line {
  readonly text: string
  readonly broken: boolean
}

const dedent = (lines: readonly string[]) => {
  const widths = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length)

  const common = widths.length === 0 ? 0 : Math.min(...widths)

  return lines.map((line) => line.slice(Math.min(common, line.length - line.trimStart().length)))
}

const propertyLine = ([key, value]: PropertyLine) =>
  value === "" ? `${key}::` : `${key}:: ${value}`

export const pagePreamble = (
  props: readonly PropertyLine[],
  options: TextOptions,
): readonly Line[] => {
  if (!options.properties || props.length === 0) {
    return []
  }

  const lines = props.map(propertyLine)

  switch (options.indent) {
    case "dashes": {
      return [...lines, ""].map((line) => ({ text: `  ${line}`, broken: false }))
    }

    case "spaces": {
      return [...lines.map((text) => ({ text, broken: false })), { text: "  ", broken: false }]
    }

    case "no-indent": {
      return lines.map((text) => ({ text, broken: false }))
    }
  }
}

const cellText = (cells: readonly Run[], inlines: Inlines) =>
  `| ${cells.map((cell) => markdownOf(cell, inlines)).join(" | ")} |`

export const textOf = (
  items: readonly Item[],
  inlines: Inlines,
  options: TextOptions,
  preamble: readonly Line[] = [],
): string => {
  const flat = options.indent === "no-indent"
  const out: Line[] = [...preamble]
  let headings = 0
  let bullet: string | null = null

  const push = (text: string, broken = false) => {
    if (bullet === null) {
      out.push({ text, broken })
    } else {
      out.push({ text: text === "" ? bullet.trimEnd() : bullet + text.trimStart(), broken })
    }

    bullet = null
  }

  const list = (entries: readonly ListItem[], tabs: string) => {
    for (const entry of entries) {
      const marker = entry.ordered ? `${entry.number ?? 1}. ` : "* "
      const box = entry.checkbox === null ? "" : entry.checkbox ? "[X] " : "[ ] "
      const [head, ...lazy] = entry.lines
      push(`${tabs}${marker}${box}${head === undefined ? "" : markdownOf(head, inlines)}`)

      for (const line of lazy) {
        const last = out.at(-1)

        if (last !== undefined && !flat) {
          out[out.length - 1] = { text: `${last.text}  `, broken: true }
        }

        push(markdownOf(line, inlines))
      }

      list(entry.children, `${tabs}\t`)
    }
  }

  for (const item of upToLevel(items, options.level)) {
    const tabs = flat ? "" : "\t".repeat(item.level - 1)

    const body = (line: string) => {
      if (flat) {
        push(line.trimStart())
      } else if (line === "") {
        push(`${tabs}  `)
      } else {
        push(`${tabs}  ${line}  `, true)
      }
    }

    const raw = (line: string) => {
      push(flat ? line.trimStart() : line === "" ? "" : `${tabs}  ${line}`)
    }

    const flush = flat ? "" : options.indent === "dashes" ? `${tabs}  ` : tabs

    switch (item._tag) {
      case "Heading": {
        const title = item.prefix + markdownOf(item.title, inlines)

        if (bullet !== null) {
          push("")
        }

        if (options.newlineAfterBlock && headings > 0 && out.at(-1)?.text.trim() !== "") {
          out.push({ text: "", broken: false })
        }

        headings++

        if (!flat && item.untitled) {
          if (options.indent === "dashes") {
            push(`${tabs}-`)
          } else {
            bullet = tabs
          }
        } else if (flat) {
          if (title.trim() !== "") {
            push(title.trim())
          }
        } else if (options.indent === "dashes") {
          push(title === "" ? `${tabs}-` : `${tabs}- ${title}`)
        } else {
          push(`${tabs}${title}`)
        }

        break
      }

      case "Properties": {
        if (options.properties) {
          item.props.forEach((prop) => {
            push(`${flush}${propertyLine(prop)}`)
          })
        }

        break
      }

      case "Paragraph": {
        item.lines.forEach((line) => {
          body(markdownOf(line, inlines))
        })

        if (options.newlineAfterBlock && !flat) {
          push(`${tabs}  `)
        }

        break
      }

      case "Quote": {
        item.lines.forEach((line) => {
          const quoted = `> ${markdownOf(line, inlines)}`

          if (flat) {
            push(quoted)
          } else {
            push(`${flush}${quoted}  `, true)
          }
        })
        break
      }

      case "Code": {
        if (flat) {
          dedent(item.lines).forEach((line) => {
            push(line)
          })
        } else {
          item.lines.forEach((line, index) => {
            index === 0 || index === item.lines.length - 1
              ? push(`${flush}${line.trimStart()}`)
              : raw(line)
          })
        }

        break
      }

      case "Raw": {
        item.lines.forEach(raw)
        break
      }

      case "Rule": {
        raw(item.line.trim())
        break
      }

      case "List": {
        list(item.items, flat ? "\t" : `${tabs}\t`)
        out.push({ text: "", broken: false })
        break
      }

      case "Table": {
        push(`${flush}${cellText(item.header, inlines)}`)
        push(`${flush}|${item.header.map(() => "---|").join("")}`)
        item.rows.forEach((row) => {
          push(`${flush}${cellText(row, inlines)}`)
        })
        break
      }
    }
  }

  if (bullet !== null) {
    push("")
  }

  while (out.at(-1)?.text === "") {
    out.pop()
  }

  const last = out.at(-1)

  if (last?.broken === true) {
    out[out.length - 1] = { ...last, text: last.text.slice(0, -2) }
  }

  return out.length === 0 ? "" : `${out.map((line) => line.text).join("\n")}\n`
}
