import { blockRefId } from "@seqno/domain"
import type { Block, Page, Props } from "@seqno/domain"
import { analyzeBlock, joinProperties } from "@seqno/syntax"
import type { PropertyLine } from "@seqno/syntax"

const numbers = new Map<string, number>()
const uuids = new Map<number, string>()

export const numberOf = (uuid: string) => {
  const known = numbers.get(uuid)

  if (known !== undefined) {
    return known
  }

  const fresh = numbers.size + 1
  numbers.set(uuid, fresh)
  uuids.set(fresh, uuid)

  return fresh
}

export const uuidOfNumber = (id: number) => uuids.get(id) ?? null

const camel = (key: string) =>
  key.replaceAll(/[-_]+([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase())

export const propertyLines = (props: Props): readonly PropertyLine[] => Object.entries(props)

export const properties = (props: Props) =>
  Object.fromEntries(Object.entries(props).map(([key, value]) => [camel(key), value]))

export const contentOf = (block: Pick<Block, "text" | "props">) =>
  joinProperties(block.text, propertyLines(block.props))

export interface BlockJson {
  readonly id: number
  readonly uuid: string
  readonly content: string
  readonly format: "markdown"
  readonly page: { readonly id: number }
  readonly parent: { readonly id: number }
  readonly left: { readonly id: number }
  readonly properties: Readonly<Record<string, string>>
  readonly collapsed: boolean
  readonly level: number
  readonly marker?: string
  readonly priority?: string
  readonly children: ReadonlyArray<BlockJson | readonly ["uuid", string]>
}

export interface PageJson {
  readonly id: number
  readonly uuid: string
  readonly name: string
  readonly originalName: string
  readonly "journal?": boolean
  readonly journalDay: number | null
  readonly properties: Readonly<Record<string, string>>
  readonly format: "markdown"
  readonly file: null
}

export const pageJson = (page: Page): PageJson => ({
  id: numberOf(page.id),
  uuid: page.id,
  name: page.name,
  originalName: page.title,
  "journal?": page.journalDay !== null,
  journalDay: page.journalDay,
  properties: properties(page.props),
  format: "markdown",
  file: null,
})

export interface Tree {
  readonly page: Page
  readonly blocks: readonly Block[]
}

const childrenIn = (tree: Tree, parentId: string | null) =>
  tree.blocks.filter((block) => block.parentId === parentId)

const levelOf = (tree: Tree, block: Block) => {
  const parents = new Map(tree.blocks.map((candidate) => [candidate.id, candidate.parentId]))
  let level = 1
  let parent = block.parentId

  while (parent !== null) {
    level += 1
    parent = parents.get(parent) ?? null
  }

  return level
}

const withMarkers = <A extends object>(json: A, text: string) => {
  const { marker, priority } = analyzeBlock(text)
  const marked = marker === null ? json : { ...json, marker }

  return priority === null ? marked : { ...marked, priority }
}

export const blockJson = (tree: Tree, block: Block, nested: boolean): BlockJson => {
  const siblings = childrenIn(tree, block.parentId)
  const before = siblings[siblings.indexOf(block) - 1]
  const parent = block.parentId ?? tree.page.id
  const children = childrenIn(tree, block.id)

  return withMarkers(
    {
      id: numberOf(block.id),
      uuid: blockRefId(block),
      content: contentOf(block),
      format: "markdown",
      page: { id: numberOf(tree.page.id) },
      parent: { id: numberOf(parent) },
      left: { id: numberOf(before?.id ?? parent) },
      properties: properties(block.props),
      collapsed: block.collapsed,
      level: levelOf(tree, block),
      children: nested
        ? children.map((child) => blockJson(tree, child, true))
        : children.map((child) => ["uuid", blockRefId(child)] as const),
    },
    block.text,
  )
}

export const changedBlock = (block: Block) =>
  withMarkers(
    {
      id: numberOf(block.id),
      uuid: blockRefId(block),
      content: contentOf(block),
      format: "markdown",
      page: { id: numberOf(block.pageId) },
      parent: { id: numberOf(block.parentId ?? block.pageId) },
      properties: properties(block.props),
    },
    block.text,
  )

export const treeJson = (tree: Tree) =>
  childrenIn(tree, null).map((block) => blockJson(tree, block, true))
