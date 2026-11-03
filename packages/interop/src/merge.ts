import { Option, Schema } from "effect"
import { BlockId, type Block, type BlockDraft, type Command, type Props } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { align, diff, likeness, merge3Text, textEdit } from "./diff.ts"
import { explicitId, preorder, type FileTree } from "./meaning.ts"
import { titleKey } from "./outline.ts"

export interface MergeBase {
  readonly file: FileTree
  readonly ids: ReadonlyArray<BlockId>
}

export interface MergeOutput {
  readonly batches: ReadonlyArray<ReadonlyArray<Command>>
  readonly ids: ReadonlyArray<BlockId>
}

export interface MergeInput {
  readonly base: MergeBase
  readonly disk: FileTree
  readonly page: PageTree
  readonly mint: () => BlockId
  readonly taken: ReadonlySet<string>
}

interface Fields {
  readonly text: string
  readonly props: Props
  readonly collapsed: boolean
}

interface Node extends Fields {
  readonly id: BlockId
  readonly parent: BlockId | null
}

const decodeBlockId = Schema.decodeUnknownOption(BlockId)

const sameProps = (a: Props, b: Props) => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

const sameFields = (a: Fields, b: Fields) =>
  a.text === b.text && a.collapsed === b.collapsed && sameProps(a.props, b.props)

export const merge3Props = (base: Props, disk: Props, page: Props): Props => {
  const keys = new Set([...Object.keys(page), ...Object.keys(disk), ...Object.keys(base)])
  const merged: Record<string, string> = {}
  for (const key of keys) {
    const value = disk[key] === base[key] ? page[key] : disk[key]
    if (value !== undefined) merged[key] = value
  }
  const order = [...Object.keys(page), ...Object.keys(disk)]
  return Object.fromEntries(
    [...new Set(order)].flatMap((key) => {
      const value = merged[key]
      return value === undefined ? [] : [[key, value] as const]
    }),
  )
}

const merge3Fields = (base: Fields, disk: Fields, page: Fields): Fields => ({
  text: merge3Text(base.text, disk.text, page.text),
  props: merge3Props(base.props, disk.props, page.props),
  collapsed: disk.collapsed === base.collapsed ? page.collapsed : disk.collapsed,
})

const contentOf = (block: Block | undefined) =>
  block === undefined ? "" : JSON.stringify([block.text, block.props, block.collapsed])

const draftIds = (drafts: ReadonlyArray<BlockDraft>): ReadonlyArray<BlockId> =>
  drafts.flatMap((draft) => [
    ...(draft.id === undefined ? [] : [draft.id]),
    ...draftIds(draft.children),
  ])

const optional = (...ids: ReadonlyArray<BlockId | null | undefined>) =>
  ids.flatMap((id) => (id === null || id === undefined ? [] : [id]))

const namedIn = (command: Command): ReadonlyArray<BlockId> => {
  switch (command._tag) {
    case "MoveBlocks":
      return [...command.blockIds, ...optional(command.parentId, command.after)]
    case "InsertBlocks":
      return optional(command.parentId, command.after)
    case "EditText":
    case "SetCollapsed":
      return [command.blockId]
    case "SetProperty":
      return command.target._tag === "BlockTarget" ? [command.target.blockId] : []
    case "DeleteBlocks":
      return command.blockIds
    default:
      return []
  }
}

class Tree {
  readonly nodes = new Map<BlockId, Node>()
  readonly children = new Map<BlockId | null, Array<BlockId>>()

  static of(nodes: ReadonlyArray<Node>) {
    const tree = new Tree()
    for (const node of nodes) {
      const parent = node.parent !== null && tree.nodes.has(node.parent) ? node.parent : null
      tree.nodes.set(node.id, { ...node, parent })
      tree.kids(parent).push(node.id)
    }
    return tree
  }

  kids(parent: BlockId | null): Array<BlockId> {
    const found = this.children.get(parent)
    if (found !== undefined) return found
    const made: Array<BlockId> = []
    this.children.set(parent, made)
    return made
  }

  parentOf(id: BlockId): BlockId | null {
    return this.nodes.get(id)?.parent ?? null
  }

  before(id: BlockId, keep: (other: BlockId) => boolean): BlockId | null {
    const siblings = this.kids(this.parentOf(id))
    for (let at = siblings.indexOf(id) - 1; at >= 0; at--) {
      const sibling = siblings[at]
      if (sibling !== undefined && keep(sibling)) return sibling
    }
    return null
  }

  detach(id: BlockId) {
    const siblings = this.kids(this.parentOf(id))
    const at = siblings.indexOf(id)
    if (at >= 0) siblings.splice(at, 1)
  }

  place(node: Node, parent: BlockId | null, after: BlockId | null) {
    const siblings = this.kids(parent)
    const at = after === null ? 0 : siblings.indexOf(after) + 1
    siblings.splice(at, 0, node.id)
    this.nodes.set(node.id, { ...node, parent })
  }

  move(id: BlockId, parent: BlockId | null, after: BlockId | null) {
    const node = this.nodes.get(id)
    if (node === undefined) return
    this.detach(id)
    this.place(node, parent, after)
  }

  within(id: BlockId, ancestor: BlockId): boolean {
    for (let at: BlockId | null = id; at !== null; at = this.parentOf(at)) {
      if (at === ancestor) return true
    }
    return false
  }

  order(): ReadonlyArray<BlockId> {
    const walk = (parent: BlockId | null): ReadonlyArray<BlockId> =>
      this.kids(parent).flatMap((id) => [id, ...walk(id)])
    return walk(null)
  }

  subtree(id: BlockId): ReadonlyArray<BlockId> {
    return [id, ...this.kids(id).flatMap((child) => this.subtree(child))]
  }
}

const nodeOf = (block: Block, id: BlockId, parent: BlockId | null): Node => ({
  id,
  parent,
  text: block.text,
  props: block.props,
  collapsed: block.collapsed,
})

const mergePageProps = (base: Props, disk: Props, page: Props) => {
  const title = titleKey(page) ?? titleKey(disk) ?? "title"
  const merged = merge3Props(base, disk, page)
  return Object.fromEntries(
    Object.entries({ ...merged, [title]: page[title] }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

const parentIndex = (blocks: ReadonlyArray<Block>) => {
  const at = new Map(blocks.map((block, index) => [block.id, index]))
  return new Map(
    blocks.map((block, index) => [
      index,
      block.parentId === null ? -1 : (at.get(block.parentId) ?? -1),
    ]),
  )
}

export const mergePage = ({
  base,
  disk,
  page,
  mint,
  taken: elsewhere,
}: MergeInput): MergeOutput => {
  const pageBlocks = preorder(page.blocks)
  const P = Tree.of(pageBlocks.map((block) => nodeOf(block, block.id, block.parentId)))
  const byExplicit = new Map<string, BlockId>()
  for (const block of pageBlocks) {
    byExplicit.set(block.id, block.id)
    const written = block.props["id"]?.toLowerCase()
    if (written !== undefined && !byExplicit.has(written)) byExplicit.set(written, block.id)
  }

  const used = new Set<string>([...pageBlocks.map((block) => block.id), ...elsewhere])
  const fresh = (): BlockId => {
    let id = mint()
    while (used.has(id)) id = mint()
    used.add(id)
    return id
  }

  const baseBlocks = preorder(base.file.tree.blocks)
  const aligned = base.ids.length === baseBlocks.length
  const baseReal = new Map<BlockId, BlockId>()
  baseBlocks.forEach((block, at) => {
    const explicit = explicitId(base.file, block)
    const real = aligned
      ? base.ids[at]
      : explicit === undefined
        ? undefined
        : byExplicit.get(explicit)
    baseReal.set(block.id, real ?? fresh())
  })
  const B = Tree.of(
    baseBlocks.map((block) =>
      nodeOf(
        block,
        baseReal.get(block.id) ?? fresh(),
        block.parentId === null ? null : (baseReal.get(block.parentId) ?? null),
      ),
    ),
  )

  const diskBlocks = preorder(disk.tree.blocks)
  const match = new Map<number, number>()
  const baseExplicit = new Map<string, number>()
  baseBlocks.forEach((block, at) => {
    const explicit = explicitId(base.file, block)
    if (explicit !== undefined) baseExplicit.set(explicit, at)
    const real = baseReal.get(block.id)
    if (real !== undefined && !baseExplicit.has(real)) baseExplicit.set(real, at)
  })
  const taken = new Set<number>()
  diskBlocks.forEach((block, at) => {
    const explicit = explicitId(disk, block)
    const found = explicit === undefined ? undefined : baseExplicit.get(explicit)
    if (found !== undefined && !taken.has(found)) {
      match.set(at, found)
      taken.add(found)
    }
  })
  const restBase = baseBlocks.flatMap((_, at) => (taken.has(at) ? [] : [at]))
  const restDisk = diskBlocks.flatMap((_, at) => (match.has(at) ? [] : [at]))
  const anchors: Array<readonly [number, number]> = []
  for (const edit of diff(
    restBase.map((at) => contentOf(baseBlocks[at])),
    restDisk.map((at) => contentOf(diskBlocks[at])),
  )) {
    if (edit._tag !== "Same") continue
    const from = restBase[edit.a]
    const to = restDisk[edit.b]
    if (from === undefined || to === undefined) continue
    match.set(to, from)
    taken.add(from)
    anchors.push([to, from])
  }
  const loose = Map.groupBy(
    baseBlocks.flatMap((block, at) => (taken.has(at) ? [] : [[contentOf(block), at] as const])),
    ([found]) => found,
  )
  diskBlocks.forEach((block, at) => {
    if (match.has(at)) return
    const from = loose.get(contentOf(block))?.shift()?.[1]
    if (from === undefined) return
    match.set(at, from)
    taken.add(from)
  })
  const baseParentAt = parentIndex(baseBlocks)
  const diskParentAt = parentIndex(diskBlocks)
  const diskKids = new Map<number, ReadonlyArray<number>>()
  for (const [kid, parent] of diskParentAt) {
    if (parent !== -1) diskKids.set(parent, [...(diskKids.get(parent) ?? []), kid])
  }
  const bounds = [[-1, -1] as const, ...anchors, [diskBlocks.length, baseBlocks.length] as const]
  bounds.slice(1).forEach(([diskEnd, baseEnd], at) => {
    const [diskStart, baseStart] = bounds[at] ?? [-1, -1]
    const gapBase = baseBlocks.flatMap((_, index) =>
      index > baseStart && index < baseEnd && !taken.has(index) ? [index] : [],
    )
    const gapDisk = diskBlocks.flatMap((_, index) =>
      index > diskStart && index < diskEnd && !match.has(index) ? [index] : [],
    )
    const score = (inBase: number, inDisk: number) => {
      const from = gapBase[inBase] ?? -1
      const to = gapDisk[inDisk] ?? -1
      const text = likeness(baseBlocks[from]?.text ?? "", diskBlocks[to]?.text ?? "")
      const kids = diskKids.get(to) ?? []
      if (kids.some((kid) => baseParentAt.get(match.get(kid) ?? -1) === from)) {
        return Math.max(text, 0.95)
      }
      return text
    }
    for (const [inBase, inDisk] of align(gapBase.length, gapDisk.length, score)) {
      const from = gapBase[inBase]
      const to = gapDisk[inDisk]
      if (from === undefined || to === undefined) continue
      match.set(to, from)
      taken.add(from)
    }
    const leftBase = gapBase.filter((index) => !taken.has(index))
    const leftDisk = gapDisk.filter((index) => !match.has(index))
    leftDisk.slice(0, leftBase.length).forEach((to, index) => {
      const from = leftBase[index]
      if (from === undefined) return
      match.set(to, from)
      taken.add(from)
    })
  })

  const diskReal = new Map<BlockId, BlockId>()
  const claimed = new Set<BlockId>()
  diskBlocks.forEach((block, at) => {
    const from = match.get(at)
    const matched = from === undefined ? undefined : baseReal.get(baseBlocks[from]?.id ?? block.id)
    if (matched !== undefined && !claimed.has(matched)) {
      diskReal.set(block.id, matched)
      claimed.add(matched)
      return
    }
    const explicit = Option.filter(decodeBlockId(explicitId(disk, block)), (id) => !used.has(id))
    if (Option.isSome(explicit)) used.add(explicit.value)
    diskReal.set(block.id, Option.getOrElse(explicit, fresh))
  })
  const D = Tree.of(
    diskBlocks.map((block) =>
      nodeOf(
        block,
        diskReal.get(block.id) ?? fresh(),
        block.parentId === null ? null : (diskReal.get(block.parentId) ?? null),
      ),
    ),
  )

  const placement = (tree: Tree, id: BlockId, keep: (other: BlockId) => boolean) =>
    `${tree.parentOf(id)}|${tree.before(id, keep)}`
  const inBoth = (left: Tree, right: Tree) => (id: BlockId) =>
    left.nodes.has(id) && right.nodes.has(id)

  const M = new Tree()
  const usePage = new Set<BlockId>()
  const kept = new Map<BlockId, Node>()
  const reborn = new Map<BlockId, BlockId>()

  for (const id of D.order()) {
    const d = D.nodes.get(id)
    if (d === undefined) continue
    const b = B.nodes.get(id)
    const p = P.nodes.get(id)
    if (b !== undefined && p === undefined) {
      if (sameFields(b, d)) continue
      const again = fresh()
      reborn.set(id, again)
      kept.set(again, { ...d, id: again })
      continue
    }
    if (b !== undefined && p !== undefined) {
      kept.set(id, { ...d, ...merge3Fields(b, d, p) })
      const diskMoved = placement(B, id, inBoth(B, D)) !== placement(D, id, inBoth(B, D))
      const pageMoved = placement(B, id, inBoth(B, P)) !== placement(P, id, inBoth(B, P))
      if (pageMoved && !diskMoved) usePage.add(id)
      continue
    }
    kept.set(id, d)
  }

  const seqnoKeeps = (id: BlockId): boolean => {
    const p = P.nodes.get(id)
    const b = B.nodes.get(id)
    if (p === undefined) return false
    if (b === undefined || !sameFields(b, p)) return true
    return P.kids(id).some((child) => !D.nodes.has(child) && seqnoKeeps(child))
  }
  for (const id of P.order()) {
    const p = P.nodes.get(id)
    if (p === undefined || D.nodes.has(id)) continue
    if (B.nodes.has(id) && !seqnoKeeps(id)) continue
    kept.set(id, p)
    usePage.add(id)
  }

  const diskParent = (id: BlockId): BlockId | null => {
    for (let at = D.parentOf(id); at !== null; at = D.parentOf(at)) {
      const mapped = reborn.get(at) ?? at
      if (kept.has(mapped)) return mapped
    }
    return null
  }
  for (const id of D.order()) {
    const own = reborn.get(id) ?? id
    const node = kept.get(own)
    if (node === undefined || usePage.has(own)) continue
    const parent = diskParent(id)
    const siblings = M.kids(parent)
    M.place(node, parent, siblings.at(-1) ?? null)
  }
  const pageParent = (id: BlockId): BlockId | null => {
    for (let at = P.parentOf(id); at !== null; at = P.parentOf(at)) {
      if (M.nodes.has(at) || kept.has(at)) return at
    }
    return null
  }
  for (const id of P.order()) {
    const node = kept.get(id)
    if (node === undefined || !usePage.has(id)) continue
    let parent = pageParent(id)
    if (parent !== null && !M.nodes.has(parent)) parent = null
    if (parent !== null && M.nodes.has(id) && M.within(parent, id)) continue
    const siblings = P.kids(P.parentOf(id))
    let after: BlockId | null = null
    for (let at = siblings.indexOf(id) - 1; at >= 0; at--) {
      const sibling = siblings[at]
      if (sibling !== undefined && M.kids(parent).includes(sibling)) {
        after = sibling
        break
      }
    }
    if (M.nodes.has(id)) M.move(id, parent, after)
    else M.place(node, parent, after)
  }

  const batches: Array<Array<Command>> = [[]]
  const createdNow = new Set<BlockId>()
  const commands = {
    push: (command: Command) => {
      if (namedIn(command).some((id) => createdNow.has(id))) {
        batches.push([])
        createdNow.clear()
      }
      batches.at(-1)?.push(command)
      if (command._tag === "InsertBlocks")
        draftIds(command.blocks).forEach((id) => createdNow.add(id))
    },
  }
  const pageId = page.page.id
  const sim = Tree.of([...P.nodes.values()])
  const inM = (id: BlockId) => M.nodes.has(id)
  const draftOf = (id: BlockId): BlockDraft => {
    const node = M.nodes.get(id)
    return {
      id,
      text: node?.text ?? "",
      props: node?.props ?? {},
      children: M.kids(id)
        .filter((child) => !sim.nodes.has(child))
        .map(draftOf),
    }
  }
  const placedNew = new Set<BlockId>()
  for (const id of M.order()) {
    if (placedNew.has(id)) continue
    const parent = M.parentOf(id)
    const after = M.before(id, () => true)
    const node = M.nodes.get(id)
    if (node === undefined) continue
    if (sim.nodes.has(id)) {
      if (sim.parentOf(id) === parent && sim.before(id, inM) === after) continue
      commands.push({
        _tag: "MoveBlocks",
        blockIds: [id],
        parentId: parent,
        ...(after === null ? {} : { after }),
      })
      sim.move(id, parent, after)
      continue
    }
    const draft = draftOf(id)
    commands.push({
      _tag: "InsertBlocks",
      pageId,
      parentId: parent,
      ...(after === null ? {} : { after }),
      blocks: [draft],
    })
    const placeDraft = (one: BlockDraft, under: BlockId | null, before: BlockId | null) => {
      const made = M.nodes.get(one.id ?? id)
      if (made === undefined) return
      sim.place(made, under, before)
      placedNew.add(made.id)
      one.children.reduce<BlockId | null>((previous, child) => {
        placeDraft(child, made.id, previous)
        return child.id ?? previous
      }, null)
    }
    placeDraft(draft, parent, after)
  }

  for (const id of M.order()) {
    const want = M.nodes.get(id)
    const has = P.nodes.get(id)
    if (want === undefined) continue
    const now: Fields = has ?? { text: want.text, props: want.props, collapsed: false }
    if (now.text !== want.text) {
      commands.push({ _tag: "EditText", blockId: id, ...textEdit(now.text, want.text) })
    }
    for (const key of new Set([...Object.keys(now.props), ...Object.keys(want.props)])) {
      if (key === "" || now.props[key] === want.props[key]) continue
      commands.push({
        _tag: "SetProperty",
        target: { _tag: "BlockTarget", blockId: id },
        key,
        value: want.props[key] ?? null,
      })
    }
    if (now.collapsed !== want.collapsed) {
      commands.push({ _tag: "SetCollapsed", blockId: id, collapsed: want.collapsed })
    }
  }

  const gone = sim
    .order()
    .filter((id) => !inM(id) && (sim.parentOf(id) === null || inM(sim.parentOf(id) ?? id)))
    .filter((id) => sim.subtree(id).every((one) => !inM(one)))
  const [first, ...rest] = gone
  if (first !== undefined) commands.push({ _tag: "DeleteBlocks", blockIds: [first, ...rest] })

  const pageProps = mergePageProps(base.file.tree.page.props, disk.tree.page.props, page.page.props)
  for (const key of new Set([...Object.keys(page.page.props), ...Object.keys(pageProps)])) {
    if (key === "" || page.page.props[key] === pageProps[key]) continue
    commands.push({
      _tag: "SetProperty",
      target: { _tag: "PageTarget", pageId },
      key,
      value: pageProps[key] ?? null,
    })
  }
  return {
    batches: batches.filter((batch) => batch.length > 0),
    ids: diskBlocks.map((block) => {
      const real = diskReal.get(block.id) ?? block.id
      return reborn.get(real) ?? real
    }),
  }
}

export const draftsOf = (file: FileTree, mint: () => BlockId, taken: ReadonlySet<string>) => {
  const blocks = preorder(file.tree.blocks)
  const used = new Set(taken)
  const ids = new Map<BlockId, BlockId>()
  for (const block of blocks) {
    const explicit = Option.filter(decodeBlockId(explicitId(file, block)), (id) => !used.has(id))
    let id = Option.getOrElse(explicit, mint)
    while (Option.isNone(explicit) && used.has(id)) id = mint()
    used.add(id)
    ids.set(block.id, id)
  }
  const children = Map.groupBy(blocks, (block) => block.parentId)
  const build = (parent: BlockId | null): ReadonlyArray<BlockDraft> =>
    (children.get(parent) ?? []).map((block) => ({
      id: ids.get(block.id) ?? mint(),
      text: block.text,
      props: block.props,
      children: build(block.id),
    }))
  const collapsed = blocks.flatMap((block) => {
    const id = ids.get(block.id)
    return block.collapsed && id !== undefined ? [id] : []
  })
  const drafts = build(null)
  return {
    drafts,
    collapsed,
    ids: blocks.flatMap((block) => Option.toArray(Option.fromUndefinedOr(ids.get(block.id)))),
  }
}
