import { element, printHtml, text, type Html } from "./html.ts"
import { escapeHtml, htmlOf, markdownOf, type Inlines } from "./inline.ts"
import { lineRun, upToLevel, type Item, type ListItem, type Run } from "./items.ts"

const markerOf = (item: Extract<Item, { _tag: "Heading" }>) =>
  item.marker === null ? "" : `${item.marker} `

const MATH = /^\s*\$\$\s*$/
const PLANNING = /^\s*(?:SCHEDULED|DEADLINE): <[^>]*>\s*$/
const FOOTNOTE = /^\s*\[\^([^\]\s]+)\]:\s*/

interface Outline {
  readonly parts: Array<string>
  readonly children: Array<Outline>
}

const tidy = (value: string) => value.replace(/\s+/g, " ").trim()

const outlineOf = (node: Outline, pad: string): string => {
  const label = escapeHtml(tidy(node.parts.join(" ")))
  return node.children.length === 0
    ? `${pad}<outline text="${label}"/>`
    : [
        `${pad}<outline text="${label}">`,
        ...node.children.map((child) => outlineOf(child, `${pad}  `)),
        `${pad}</outline>`,
      ].join("\n")
}

export const opmlOf = (
  items: ReadonlyArray<Item>,
  inlines: Inlines,
  title: string,
  level: number | null,
): string => {
  const root: Outline = { parts: [], children: [] }
  const path: Array<Outline> = [root]
  const current = () => {
    const at = path.at(-1)
    if (at !== undefined && at !== root) return at
    const loose: Outline = { parts: [], children: [] }
    root.children.push(loose)
    path.push(loose)
    return loose
  }
  const lines = (runs: ReadonlyArray<Run>) => runs.map((run) => markdownOf(run, inlines))
  const listed = (entries: ReadonlyArray<ListItem>): Array<Outline> =>
    entries.map((entry) => ({ parts: lines(entry.lines), children: listed(entry.children) }))
  for (const item of upToLevel(items, level)) {
    switch (item._tag) {
      case "Heading": {
        path.length = Math.min(path.length, item.level)
        const node: Outline = {
          parts: [`${markerOf(item)}${markdownOf(item.title, inlines)}`],
          children: [],
        }
        ;(path.at(-1) ?? root).children.push(node)
        path.push(node)
        break
      }
      case "Paragraph":
      case "Quote":
        current().parts.push(...lines(item.lines))
        break
      case "Code":
        current().parts.push(...item.lines.slice(1, -1))
        break
      case "Raw":
        if (MATH.test(item.lines[0] ?? "") || FOOTNOTE.test(item.lines[0] ?? ""))
          current().parts.push(...item.lines.filter((line) => !MATH.test(line)))
        break
      case "List":
        current().children.push(...listed(item.items))
        break
      case "Properties":
      case "Table":
      case "Rule":
        break
    }
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>${escapeHtml(title)}</title>`,
    `  </head>`,
    ...(root.children.length === 0
      ? [`  <body/>`]
      : [`  <body>`, ...root.children.map((node) => outlineOf(node, "    ")), `  </body>`]),
    `</opml>`,
  ].join("\n")
}

interface Open {
  readonly node: Html
  readonly children: Array<Html>
}

const open = (name: string, attrs: ReadonlyArray<readonly [string, string]> = []): Open => {
  const children: Array<Html> = []
  return { node: element(name, children, attrs), children }
}

export const htmlOfItems = (
  items: ReadonlyArray<Item>,
  inlines: Inlines,
  level: number | null,
): string => {
  const kept = upToLevel(items, level)
  const root = open("ul")
  const lists: Array<Open> = [root]
  let item: Open | null = null
  const list = () => lists.at(-1) ?? root
  const into = (): Open => {
    if (item !== null) return item
    const loose = open("li")
    list().children.push(loose.node)
    item = loose
    return loose
  }
  const lineBreaks = (runs: ReadonlyArray<Run>, trailing: boolean) =>
    runs.flatMap((run, index) => [
      ...(PLANNING.test(run.source.slice(run.from, run.to))
        ? [element("span", [text(run.source.slice(run.from, run.to).trim())])]
        : htmlOf(run, inlines)),
      ...(index < runs.length - 1 || trailing ? [element("br")] : []),
    ])
  const listed = (entries: ReadonlyArray<ListItem>): Html => {
    const nested = open("ul")
    for (const entry of entries) {
      nested.children.push(element("li", [element("p", lineBreaks(entry.lines, false))]))
      if (entry.children.length > 0) nested.children.push(listed(entry.children))
    }
    return nested.node
  }
  const row = (name: string, cells: ReadonlyArray<Run>) =>
    element(
      "tr",
      cells.map((cell) => element(name, htmlOf(cell, inlines))),
    )
  kept.forEach((entry, index) => {
    const trailing = index < kept.length - 1
    switch (entry._tag) {
      case "Heading": {
        while (lists.length > entry.level) lists.pop()
        while (lists.length < entry.level) {
          const nested = open("ul")
          list().children.push(nested.node)
          lists.push(nested)
        }
        const li = open("li")
        const marker = markerOf(entry)
        li.children.push(...(marker === "" ? [] : [text(marker)]), ...htmlOf(entry.title, inlines))
        list().children.push(li.node)
        item = li
        break
      }
      case "Paragraph":
        into().children.push(element("p", lineBreaks(entry.lines, trailing)))
        break
      case "Quote":
        into().children.push(
          element("blockquote", [element("p", lineBreaks(entry.lines, trailing))]),
        )
        break
      case "Code":
        into().children.push(
          element(
            "pre",
            [
              text(
                entry.lines
                  .slice(1, -1)
                  .map((line) => `${line}\n`)
                  .join(""),
              ),
            ],
            entry.language === "" ? [] : [["data-lang", entry.language]],
          ),
        )
        break
      case "Raw": {
        const [head = "", ...rest] = entry.lines
        const note = FOOTNOTE.exec(head)
        if (note !== null) {
          into().children.push(
            element("div", [
              ...htmlOf(lineRun(head.slice(note[0].length)), inlines),
              element("sup", [text(`${note[1] ?? ""}↩`)], [["id", `fnd.${note[1] ?? ""}`]]),
            ]),
          )
        } else if (MATH.test(head)) {
          into().children.push(
            element("span", [text(rest.filter((line) => !MATH.test(line)).join("\n"))]),
          )
        }
        break
      }
      case "Rule":
        into().children.push(element("hr"))
        break
      case "Table":
        into().children.push(
          element(
            "table",
            [row("th", entry.header), ...entry.rows.map((cells) => row("td", cells))],
            [["style", "width:100%"]],
          ),
        )
        break
      case "List":
        into()
        list().children.push(listed(entry.items))
        break
      case "Properties":
        break
    }
  })
  return root.children.length === 0 ? "" : printHtml(root.node)
}
