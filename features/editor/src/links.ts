import { parseInline, type Inline } from "@seqno/syntax"
import type { LinkTarget } from "./host.ts"

const targetOf = (node: Inline): LinkTarget | null =>
  node._tag === "PageRef" || node._tag === "Tag"
    ? { _tag: "Page", name: node.name }
    : node._tag === "BlockRef"
      ? { _tag: "Block", uuid: node.uuid }
      : node._tag === "Link"
        ? node.target
        : null

const inside = (node: Inline): ReadonlyArray<Inline> =>
  "children" in node ? node.children : node._tag === "Link" ? node.label : []

const search = (nodes: ReadonlyArray<Inline>, offset: number): LinkTarget | null => {
  const node = nodes.find(({ span }) => span.from <= offset && offset <= span.to)
  return node === undefined ? null : (targetOf(node) ?? search(inside(node), offset))
}

export const linkAt = (text: string, offset: number) => search(parseInline(text), offset)
