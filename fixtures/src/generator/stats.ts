import type { GeneratedGraph } from "./graph.ts"

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
  return { min: sorted[0]!, p50: at(0.5), p95: at(0.95), max: sorted.at(-1)!, mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length) }
}

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0

export const graphStats = (graph: GeneratedGraph) => {
  const depthOf = new Map<string, number>()
  const depth: Record<number, number> = {}
  const perPage = new Map<string, number>()
  let pageRefs = 0, tags = 0, blockRefs = 0, tasks = 0, properties = 0, multiline = 0
  for (const b of graph.blocks) {
    const d = b.parentId === null ? 1 : depthOf.get(b.parentId)! + 1
    depthOf.set(b.id, d)
    depth[d] = (depth[d] ?? 0) + 1
    perPage.set(b.pageId, (perPage.get(b.pageId) ?? 0) + 1)
    pageRefs += count(b.text, /(?<!#)\[\[[^\]]+\]\]/g)
    tags += count(b.text, /#(\[\[[^\]]+\]\]|[\w/-]+)/g)
    blockRefs += count(b.text, /\(\([0-9a-f-]{36}\)\)/g)
    tasks += /^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELED) /.test(b.text) ? 1 : 0
    properties += count(b.text, /^[a-z]+:: /gm)
    multiline += b.text.includes("\n") ? 1 : 0
  }
  return {
    pages: graph.pages.filter((p) => p.journalDay === null).length,
    journals: graph.pages.filter((p) => p.journalDay !== null).length,
    blocks: graph.blocks.length,
    depth,
    blocksPerPage: summary(graph.pages.map((p) => perPage.get(p.id) ?? 0)),
    textLength: summary(graph.blocks.map((b) => b.text.length)),
    pageRefs,
    tags,
    blockRefs,
    tasks,
    properties,
    multiline,
  }
}
