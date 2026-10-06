import { Option, Schema } from "effect"
import { LoroMap, LoroText, type LoroTreeNode, type TreeID } from "loro-crdt"
import {
  BlockId,
  JournalDay,
  PageId,
  Props,
  normalizePageName,
  type Block,
  type Page,
} from "@seqno/domain"

export const TREE = "blocks"

const EpochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const PageData = Schema.Struct({
  uuid: PageId,
  title: Schema.String,
  journalDay: Schema.optionalKey(JournalDay),
  props: Schema.optionalKey(Props),
})

const BlockData = Schema.Struct({
  uuid: BlockId,
  text: Schema.optionalKey(Schema.String),
  collapsed: Schema.optionalKey(Schema.Boolean),
  props: Schema.optionalKey(Props),
  created: Schema.optionalKey(EpochMillis),
  updated: Schema.optionalKey(EpochMillis),
})

const decodePageData = Schema.decodeUnknownOption(PageData)
const decodeBlockData = Schema.decodeUnknownOption(BlockData)
const decodeBlockId = Schema.decodeUnknownOption(BlockId)
const decodePageId = Schema.decodeUnknownOption(PageId)

export interface Placement {
  readonly pageId: PageId
  readonly parentId: BlockId | null
}

export interface BlockState {
  readonly block: Block
  readonly createdAt: number
  readonly updatedAt: number
}

export const isTreeId = (value: unknown): value is TreeID =>
  typeof value === "string" && /^\d+@\d+$/.test(value)

export const childrenOf = (node: LoroTreeNode): ReadonlyArray<LoroTreeNode> =>
  node.children() ?? []

export const blockIdOf = (node: LoroTreeNode): Option.Option<BlockId> =>
  decodeBlockId(node.data.get("uuid"))

export const pageIdOf = (node: LoroTreeNode): Option.Option<PageId> =>
  decodePageId(node.data.get("uuid"))

export const readPage = (node: LoroTreeNode): Option.Option<Page> =>
  Option.flatMap(decodePageData(node.data.toJSON()), (data) => {
    const name = normalizePageName(data.title)
    return name === ""
      ? Option.none()
      : Option.some({
          id: data.uuid,
          name,
          title: data.title,
          journalDay: data.journalDay ?? null,
          props: data.props ?? {},
        })
  })

export const readBlock = (node: LoroTreeNode, at: Placement): Option.Option<BlockState> =>
  Option.map(decodeBlockData(node.data.toJSON()), (data) => ({
    block: {
      id: data.uuid,
      pageId: at.pageId,
      parentId: at.parentId,
      text: data.text ?? "",
      collapsed: data.collapsed ?? false,
      props: data.props ?? {},
    },
    createdAt: data.created ?? 0,
    updatedAt: data.updated ?? data.created ?? 0,
  }))

export const textOf = (node: LoroTreeNode): LoroText => {
  const text = node.data.get("text")
  return text instanceof LoroText ? text : node.data.ensureMergeableText("text")
}

export const propsOf = (node: LoroTreeNode): LoroMap => {
  const props = node.data.get("props")
  return props instanceof LoroMap ? props : node.data.ensureMergeableMap("props")
}

export const textValue = (node: LoroTreeNode): string => {
  const text = node.data.get("text")
  return text instanceof LoroText ? text.toString() : ""
}

export const isCollapsed = (node: LoroTreeNode): boolean => node.data.get("collapsed") === true

export const writePage = (node: LoroTreeNode, id: PageId, title: string): void => {
  node.data.set("uuid", id)
  node.data.set("title", title)
  node.data.ensureMergeableMap("props")
}

export const writeBlock = (node: LoroTreeNode, id: BlockId, text: string, now: number): void => {
  node.data.set("uuid", id)
  node.data.ensureMergeableText("text").insert(0, text)
  node.data.ensureMergeableMap("props")
  node.data.set("created", now)
  node.data.set("updated", now)
}

export const touch = (node: LoroTreeNode, now: number): void => {
  node.data.set("updated", now)
}

export const placementOf = (node: LoroTreeNode): Option.Option<Placement> => {
  const parent = node.parent()
  const grandparent = parent?.parent()
  if (parent === undefined) return Option.none()
  if (grandparent === undefined) {
    return Option.map(pageIdOf(parent), (pageId) => ({ pageId, parentId: null }))
  }
  return Option.flatMap(placementOf(parent), (above) =>
    Option.map(blockIdOf(parent), (parentId) => ({ pageId: above.pageId, parentId })),
  )
}

export const walkBlocks = (
  node: LoroTreeNode,
  at: Placement,
  visit: (child: LoroTreeNode, at: Placement) => Option.Option<BlockId>,
): void => {
  for (const child of childrenOf(node)) {
    Option.map(visit(child, at), (id) =>
      walkBlocks(child, { pageId: at.pageId, parentId: id }, visit),
    )
  }
}
