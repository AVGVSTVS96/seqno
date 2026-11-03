import { escapeHtml, htmlOf, markdownOf, type Inlines } from "./inline.ts"
import { upToLevel, type Item } from "./items.ts"

interface Node {
  readonly level: number
  readonly parts: Array<string>
  readonly children: Array<Node>
}

const treeOf = (
  items: ReadonlyArray<Item>,
  heading: (item: Extract<Item, { _tag: "Heading" }>) => string,
  body: (item: Item) => string | null,
): ReadonlyArray<Node> => {
  const root: Node = { level: 0, parts: [], children: [] }
  const path: Array<Node> = [root]
  for (const item of items) {
    if (item._tag === "Heading") {
      while (path.length > 1 && (path.at(-1)?.level ?? 0) >= item.level) path.pop()
      const node: Node = { level: item.level, parts: [heading(item)], children: [] }
      path.at(-1)?.children.push(node)
      path.push(node)
      continue
    }
    const part = body(item)
    if (part === null) continue
    let current = path.at(-1)
    if (current === undefined || current === root) {
      current = { level: item.level, parts: [], children: [] }
      root.children.push(current)
      path.push(current)
    }
    current.parts.push(part)
  }
  return root.children
}

const markerOf = (item: Extract<Item, { _tag: "Heading" }>) =>
  item.marker === null ? "" : `${item.marker} `

const xmlAttribute = (text: string) =>
  escapeHtml(text).replaceAll("\n", "&#10;").replaceAll("\t", "&#9;")

const outline = (node: Node, pad: string): string => {
  const text = xmlAttribute(node.parts.filter((part) => part !== "").join(" "))
  return node.children.length === 0
    ? `${pad}<outline text="${text}"/>`
    : [
        `${pad}<outline text="${text}">`,
        ...node.children.map((child) => outline(child, `${pad}  `)),
        `${pad}</outline>`,
      ].join("\n")
}

export const opmlOf = (
  items: ReadonlyArray<Item>,
  inlines: Inlines,
  title: string,
  level: number | null,
): string => {
  const nodes = treeOf(
    upToLevel(items, level),
    (item) => `${markerOf(item)}${markdownOf(item.title, inlines)}`.trim(),
    (item) => {
      switch (item._tag) {
        case "Paragraph":
        case "Quote":
          return item.lines
            .map((line) => markdownOf(line, inlines).trim())
            .filter((line) => line !== "")
            .join(" ")
        case "Code":
          return item.lines.slice(1, -1).join(" ")
        default:
          return null
      }
    },
  )
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>${escapeHtml(title)}</title>`,
    `  </head>`,
    ...(nodes.length === 0
      ? [`  <body/>`]
      : [`  <body>`, ...nodes.map((node) => outline(node, "    ")), `  </body>`]),
    `</opml>`,
    "",
  ].join("\n")
}

export const htmlOfItems = (
  items: ReadonlyArray<Item>,
  inlines: Inlines,
  level: number | null,
): string => {
  const nodes = treeOf(
    upToLevel(items, level),
    (item) => `${escapeHtml(markerOf(item))}${htmlOf(item.title, inlines)}`,
    (item) => {
      switch (item._tag) {
        case "Paragraph":
          return `<p>${item.lines.map((line) => htmlOf(line, inlines)).join("<br/>")}</p>`
        case "Quote":
          return `<blockquote><p>${item.lines.map((line) => htmlOf(line, inlines)).join("<br/>")}</p></blockquote>`
        case "Code": {
          const lang = item.language === "" ? "" : ` data-lang="${escapeHtml(item.language)}"`
          return `<pre${lang}>${escapeHtml(item.lines.slice(1, -1).join("\n"))}</pre>`
        }
        default:
          return null
      }
    },
  )
  const list = (children: ReadonlyArray<Node>, pad: string): string =>
    [`${pad}<ul>`, ...children.map((child) => listItem(child, `${pad}  `)), `${pad}</ul>`].join(
      "\n",
    )
  const listItem = (node: Node, pad: string): string => {
    const [head = "", ...rest] = node.parts
    if (rest.length === 0 && node.children.length === 0) return `${pad}<li>${head}</li>`
    return [
      `${pad}<li>${head}`,
      ...rest.map((part) => `${pad}  ${part}`),
      ...(node.children.length === 0 ? [] : [list(node.children, `${pad}  `)]),
      `${pad}</li>`,
    ].join("\n")
  }
  return nodes.length === 0 ? "" : `${list(nodes, "")}\n`
}
