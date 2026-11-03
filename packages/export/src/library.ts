import type { Block, BlockId, Page, PageId } from "@seqno/domain"
import { defaultPropertyConfig, type PropertyConfig } from "@seqno/syntax"

export interface PageBlocks {
  readonly page: Page
  readonly blocks: ReadonlyArray<Block>
}

export interface Library {
  readonly pages: ReadonlyArray<PageBlocks>
  readonly referenced: ReadonlySet<string>
  readonly properties?: PropertyConfig
}

export interface Shelf {
  readonly children: (pageId: PageId, parentId: BlockId | null) => ReadonlyArray<Block>
  readonly block: (uuid: string) => Block | undefined
  readonly page: (name: string) => PageBlocks | undefined
  readonly logseqId: (block: Block) => string
  readonly referenced: (block: Block) => boolean
  readonly properties: PropertyConfig
}

const blockRef = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi

export const referencedIds = (pages: ReadonlyArray<PageBlocks>): ReadonlySet<string> =>
  new Set(
    pages.flatMap(({ blocks }) =>
      blocks.flatMap((block) =>
        [block.text, ...Object.values(block.props)].flatMap((text) =>
          [...text.matchAll(blockRef)].map((match) => (match[1] ?? "").toLowerCase()),
        ),
      ),
    ),
  )

const logseqId = (block: Block) => (block.props["id"] ?? block.id).toLowerCase()

export const shelve = ({ pages, referenced, properties }: Library): Shelf => {
  const byUuid = new Map<string, Block>()
  const byParent = new Map<string, Array<Block>>()
  const byName = new Map<string, PageBlocks>()
  for (const entry of pages) {
    byName.set(entry.page.name, entry)
    const ids = new Set(entry.blocks.map((block) => block.id))
    for (const block of entry.blocks) {
      byUuid.set(block.id.toLowerCase(), block)
      const written = block.props["id"]
      if (written !== undefined) byUuid.set(written.toLowerCase(), block)
      const parent = block.parentId !== null && ids.has(block.parentId) ? block.parentId : ""
      const key = `${entry.page.id}/${parent}`
      const siblings = byParent.get(key)
      if (siblings === undefined) byParent.set(key, [block])
      else siblings.push(block)
    }
  }
  return {
    children: (pageId, parentId) => byParent.get(`${pageId}/${parentId ?? ""}`) ?? [],
    block: (uuid) => byUuid.get(uuid.toLowerCase()),
    page: (name) => byName.get(name.normalize("NFC").trim().toLowerCase()),
    logseqId,
    referenced: (block) =>
      referenced.has(block.id.toLowerCase()) || referenced.has(logseqId(block)),
    properties: properties ?? defaultPropertyConfig,
  }
}
