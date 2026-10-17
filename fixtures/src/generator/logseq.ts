import type { GraphFile } from "../files.ts"
import { generatePages, type GeneratedBlock, type GeneratedGraph, type GeneratedPage, type GeneratorOptions } from "./graph.ts"

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

export const configFile: GraphFile = { path: "logseq/config.edn", content: logseqConfig }

const referencedIn = (blocks: Iterable<GeneratedBlock>, into = new Set<string>()) => {
  for (const block of blocks) for (const [, id] of block.text.matchAll(/\(\(([0-9a-f-]{36})\)\)/g)) into.add(id!)
  return into
}

const pageFile = (page: GeneratedPage, blocks: Iterable<GeneratedBlock>, referenced: ReadonlySet<string>): GraphFile => {
  const depth = new Map<string, number>()
  const out: string[] = []
  for (const block of blocks) {
    const d = block.parentId === null ? 0 : depth.get(block.parentId)! + 1
    depth.set(block.id, d)
    const text = block.text.split("\n")
    const indent = "\t".repeat(d)
    for (const [i, line] of (referenced.has(block.id) ? withId(text, block.id) : text).entries())
      out.push(`${indent}${i === 0 ? "- " : "  "}${line}`)
  }
  return { path: pagePath(page), content: `${out.join("\n")}\n` }
}

export const toLogseqFiles = (graph: GeneratedGraph): GraphFile[] => {
  const referenced = referencedIn(graph.blocks)
  const byPage = new Map<string, GeneratedBlock[]>(graph.pages.map((page) => [page.id, []]))
  for (const block of graph.blocks) byPage.get(block.pageId)!.push(block)
  return [configFile, ...graph.pages.map((page) => pageFile(page, byPage.get(page.id)!, referenced))]
}

export function* logseqPageFiles(options: Partial<GeneratorOptions> = {}): Generator<GraphFile> {
  const referenced = new Set<string>()
  for (const { blocks } of generatePages(options)) referencedIn(blocks, referenced)
  for (const { page, blocks } of generatePages(options)) yield pageFile(page, blocks, referenced)
}
