import { Option, Result, Schema } from "effect"
import { BlockId, PageId, normalizePageName } from "@seqno/domain"
import type { Block, Props } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import type { LogseqConfig } from "./config.ts"
import { readFile } from "./files.ts"
import type { PageFile } from "./files.ts"
import { seededIds } from "./ids.ts"
import type { LogseqSyntax } from "./outline.ts"

export interface FileTree {
  readonly tree: PageTree
  readonly synthetic: ReadonlySet<BlockId>
}

const filePage = PageId.make("00000000-0000-7000-8000-000000000000")
const decodeBlockId = Schema.decodeUnknownOption(BlockId)

export const readFileTree = (
  file: PageFile,
  text: string,
  config: LogseqConfig,
  syntax: LogseqSyntax["Service"],
): Result.Result<FileTree, string> =>
  Result.flatMap(readFile(file, text, config, syntax), (content) => {
    const name = normalizePageName(content.page.title)

    if (name === "") {
      return Result.fail("the file names no page")
    }

    const ids = seededIds(Uint8Array.from({ length: 16 }, (_, index) => index + 1))
    const synthetic = new Set<BlockId>()
    const used = new Set<string>()

    const blocks = content.blocks(filePage, (written) => {
      const kept = Option.filter(decodeBlockId(written?.toLowerCase()), (id) => !used.has(id))
      const id = Option.isSome(kept) ? kept.value : ids.block()

      if (Option.isNone(kept)) {
        synthetic.add(id)
      }

      used.add(id)

      return id
    })

    return Result.succeed({
      tree: { page: { id: filePage, name, ...content.page }, blocks },
      synthetic,
    })
  })

export const explicitId = (file: FileTree, block: Block): string | undefined =>
  block.props["id"]?.toLowerCase() ?? (file.synthetic.has(block.id) ? undefined : block.id)

export const preorder = (blocks: readonly Block[]): readonly Block[] => {
  const ids = new Set(blocks.map((block) => block.id))

  const children = Map.groupBy(blocks, (block) =>
    block.parentId !== null && ids.has(block.parentId) ? block.parentId : null,
  )

  const walk = (parent: BlockId | null): readonly Block[] =>
    (children.get(parent) ?? []).flatMap((block) => [block, ...walk(block.id)])

  return walk(null)
}

const sameProps = (a: Props, b: Props): boolean => {
  const keys = Object.keys(a)

  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

const depths = (blocks: readonly Block[]) => {
  const depth = new Map<BlockId | null, number>([[null, -1]])

  return preorder(blocks).map((block) => {
    const at = (depth.get(block.parentId) ?? -1) + 1
    depth.set(block.id, at)

    return [at, block] as const
  })
}

export const sameMeaning = (a: PageTree, b: PageTree): boolean => {
  if (
    a.page.title !== b.page.title ||
    a.page.journalDay !== b.page.journalDay ||
    a.page.frontMatter !== b.page.frontMatter ||
    a.page.format !== b.page.format ||
    !sameProps(a.page.props, b.page.props) ||
    a.blocks.length !== b.blocks.length
  ) {
    return false
  }

  const left = depths(a.blocks)
  const right = depths(b.blocks)

  return left.every(([depth, block], index) => {
    const other = right[index]

    return (
      other !== undefined &&
      other[0] === depth &&
      other[1].text === block.text &&
      other[1].collapsed === block.collapsed &&
      sameProps(other[1].props, block.props)
    )
  })
}

export const writtenIds = (file: FileTree): ReadonlySet<string> =>
  new Set(
    file.tree.blocks.flatMap((block) =>
      Option.toArray(Option.fromUndefinedOr(block.props["id"]?.toLowerCase())),
    ),
  )
