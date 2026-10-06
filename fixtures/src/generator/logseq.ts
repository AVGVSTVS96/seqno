import type { GraphFile } from "../files.ts"
import type { GeneratedGraph, GeneratedPage } from "./graph.ts"

export const logseqConfig = `{:meta/version 1
 :preferred-format "Markdown"
 :journal/page-title-format "MMM do, yyyy"
 :file/name-format :triple-lowbar}
`

const pad = (n: number) => String(n).padStart(2, "0")

const pagePath = (page: GeneratedPage) =>
  page.journalDay === null
    ? `pages/${page.name.replaceAll("/", "___")}.md`
    : `journals/${Math.floor(page.journalDay / 10_000)}_${pad(Math.floor(page.journalDay / 100) % 100)}_${pad(page.journalDay % 100)}.md`

const headerLine = /^(SCHEDULED|DEADLINE): |^[a-z][\w-]*:: /

const withId = (lines: readonly string[], id: string) => {
  let at = 1
  while (at < lines.length && headerLine.test(lines[at]!)) at++
  return [...lines.slice(0, at), `id:: ${id}`, ...lines.slice(at)]
}

export const toLogseqFiles = (graph: GeneratedGraph): GraphFile[] => {
  const referenced = new Set<string>()
  for (const block of graph.blocks) for (const [, id] of block.text.matchAll(/\(\(([0-9a-f-]{36})\)\)/g)) referenced.add(id!)
  const depth = new Map<string, number>()
  const lines = new Map<string, string[]>(graph.pages.map((page) => [page.id, []]))
  for (const block of graph.blocks) {
    const d = block.parentId === null ? 0 : depth.get(block.parentId)! + 1
    depth.set(block.id, d)
    const text = block.text.split("\n")
    const indent = "\t".repeat(d)
    const out = lines.get(block.pageId)!
    for (const [i, line] of (referenced.has(block.id) ? withId(text, block.id) : text).entries())
      out.push(`${indent}${i === 0 ? "- " : "  "}${line}`)
  }
  return [
    { path: "logseq/config.edn", content: logseqConfig },
    ...graph.pages.map((page) => ({ path: pagePath(page), content: `${lines.get(page.id)!.join("\n")}\n` })),
  ]
}
