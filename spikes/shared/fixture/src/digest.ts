import type { Graph } from "./graph.ts"

export const graphDigest = (graph: Pick<Graph, "pages" | "blocks">): string => {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 0x01000193)
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13)
    }
  }
  for (const p of graph.pages) feed(`P\t${p.id}\t${p.name}\t${p.journalDay ?? ""}\n`)
  for (const b of graph.blocks) feed(`B\t${b.id}\t${b.pageId}\t${b.parentId ?? ""}\t${b.content}\n`)
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")
}
