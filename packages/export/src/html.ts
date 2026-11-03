export type Html =
  | {
      readonly _tag: "Element"
      readonly name: string
      readonly attrs: ReadonlyArray<readonly [string, string]>
      readonly children: ReadonlyArray<Html>
    }
  | { readonly _tag: "Text"; readonly text: string }

export const element = (
  name: string,
  children: ReadonlyArray<Html> = [],
  attrs: ReadonlyArray<readonly [string, string]> = [],
): Html => ({ _tag: "Element", name, attrs, children })

export const text = (value: string): Html => ({ _tag: "Text", text: value })

const escapeText = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const escapeAttribute = (value: string) => escapeText(value).replaceAll('"', "&quot;")

const open = (node: Extract<Html, { _tag: "Element" }>) =>
  `<${node.name}${node.attrs.map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join("")}`

const inline = (node: Html): string => {
  if (node._tag === "Text") return escapeText(node.text)
  return node.children.length === 0
    ? `${open(node)}/>`
    : `${open(node)}>${node.children.map(inline).join("")}</${node.name}>`
}

export const printHtml = (node: Html, depth = 0): string => {
  const pad = "  ".repeat(depth)
  if (node._tag === "Text" || node.children.some((child) => child._tag === "Text"))
    return `${pad}${inline(node)}`
  if (node.children.length === 0) return `${pad}${open(node)}/>`
  return [
    `${pad}${open(node)}>`,
    ...node.children.map((child) => printHtml(child, depth + 1)),
    `${pad}</${node.name}>`,
  ].join("\n")
}
