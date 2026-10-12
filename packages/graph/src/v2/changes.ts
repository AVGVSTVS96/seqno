import { Option, Schema } from "effect"
import { PageId, type BlockId } from "@seqno/domain"
import { loroVersion, type Changed } from "../changes.ts"
import { blockIdOf, isTreeId } from "../tree.ts"
import { MERGED, MOVED, isDirectory, pageOfTree } from "./layout.ts"
import { homeOf, locate, type Located, type Trees } from "./outline.ts"
import { spotsOf } from "./repair.ts"

const decodePageId = Schema.decodeUnknownOption(PageId)

export const changedSince = (
  trees: Trees,
  since: ReadonlyMap<string, number>,
): Option.Option<Changed> => {
  const { doc } = trees
  const from = loroVersion(since)
  const order = doc.oplogVersion().compare(from)
  if (since.size === 0 || order === undefined || order < 0) return Option.none()
  const nodes = new Set<string>()
  const pages = new Set<PageId>()
  const addPage = (id: unknown) => Option.map(decodePageId(id), (page) => pages.add(page))
  const spans = doc.findIdSpansBetween(doc.vvToFrontiers(from), doc.oplogFrontiers()).forward
  for (const span of spans) {
    const keyed = new Set<string>()
    for (const container of doc.getChangedContainersIn(span, span.length)) {
      const [root, below] = doc.getPathToContainer(container) ?? []
      if (root === MOVED) continue
      if (isDirectory(root)) {
        if (below === undefined) keyed.add(container)
        else addPage(below)
        continue
      }
      const page = pageOfTree(root)
      if (Option.isNone(page)) return Option.none()
      pages.add(page.value)
      if (below === undefined) keyed.add(container)
      else if (isTreeId(below)) nodes.add(`${page.value}|${below}`)
      else return Option.none()
    }
    if (keyed.size === 0) continue
    for (const change of doc.exportJsonInIdSpan(span)) {
      for (const op of change.ops) {
        if (!keyed.has(op.container)) continue
        const content = op.content
        if ("target" in content) {
          Option.map(pageOfTree(doc.getPathToContainer(op.container)?.[0]), (page) =>
            nodes.add(`${page}|${content.target}`),
          )
        } else if ("key" in content) {
          addPage(content.key)
          if (doc.getPathToContainer(op.container)?.[0] === MERGED && "value" in content) {
            addPage(content.value)
          }
        }
      }
    }
  }
  const blocks = new Set<BlockId>()
  const memo: Located = new Map()
  for (const spot of spotsOf(trees, nodes)) {
    const home = homeOf(trees, spot)
    Option.map(blockIdOf(home.node), (id) => blocks.add(id))
    const where = locate(trees, home, memo)
    if (where._tag === "Live") pages.add(where.page)
  }
  return Option.some({ pages, blocks })
}
