import { LoroText, type LoroDoc, type LoroTree, type TreeID } from "loro-crdt"
import type { Rng } from "./rng.ts"

/**
 * Block text is a run of unique units "[<device>.<seq>] ". Inserts land on unit boundaries and deletes remove
 * whole units, so every unit stays contiguous under merging and can be checked individually at the end.
 */
export interface Intent {
  readonly blocks: TreeID[]
  readonly pages: TreeID[]
  readonly explicitlyDeleted: Set<TreeID>
  readonly tokens: Map<string, TreeID>
  readonly deadTokens: Set<string>
  readonly counts: Record<OpKind | "cyclePairs" | "rejected", number>
}

export type OpKind = "insertText" | "deleteText" | "createBlock" | "deleteBlock" | "moveBlock" | "renamePage" | "createPage" | "deletePage"

const MIX: readonly (readonly [OpKind | "cyclePair", number])[] = [
  ["insertText", 0.34],
  ["deleteText", 0.08],
  ["createBlock", 0.2],
  ["deleteBlock", 0.05],
  ["moveBlock", 0.2],
  ["renamePage", 0.04],
  ["createPage", 0.03],
  ["deletePage", 0.005],
  ["cyclePair", 0.055],
]

export const createIntent = (): Intent => ({
  blocks: [],
  pages: [],
  explicitlyDeleted: new Set(),
  tokens: new Map(),
  deadTokens: new Set(),
  counts: {
    insertText: 0,
    deleteText: 0,
    createBlock: 0,
    deleteBlock: 0,
    moveBlock: 0,
    renamePage: 0,
    createPage: 0,
    deletePage: 0,
    cyclePairs: 0,
    rejected: 0,
  },
})

const treeOf = (doc: LoroDoc) => doc.getTree("blocks")

export const alive = (tree: LoroTree, id: TreeID) => tree.has(id) && !tree.isNodeDeleted(id)

const textOf = (tree: LoroTree, id: TreeID) => tree.getNodeByID(id)!.data.get("src") as LoroText

const unitEnds = (s: string) => {
  const ends = [0]
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 32) ends.push(i + 1)
  return ends
}

const TOKEN = /\[\d+\.\d+\]/g

const isAncestor = (tree: LoroTree, ancestor: TreeID, node: TreeID) => {
  for (let cur = tree.getNodeByID(node); cur; cur = cur.parent()) if (cur.id === ancestor) return true
  return false
}

export class Workload {
  private seq = 0
  private readonly rng: Rng
  readonly intent: Intent

  constructor(rng: Rng, intent: Intent) {
    this.rng = rng
    this.intent = intent
  }

  private token(device: number) {
    return `[${device}.${this.seq++}]`
  }

  private pickAlive(tree: LoroTree, ids: readonly TreeID[]): TreeID | undefined {
    if (ids.length === 0) return undefined
    for (let i = 0; i < 16; i++) {
      const r = this.rng.next()
      const id = ids[ids.length - 1 - Math.floor(ids.length * r * r)]!
      if (alive(tree, id)) return id
    }
    return undefined
  }

  private pickParent(tree: LoroTree) {
    return this.rng.chance(0.3) ? this.pickAlive(tree, this.intent.pages) : (this.pickAlive(tree, this.intent.blocks) ?? this.pickAlive(tree, this.intent.pages))
  }

  private insertUnit(tree: LoroTree, block: TreeID, device: number) {
    const text = textOf(tree, block)
    const ends = unitEnds(text.toString())
    const token = this.token(device)
    text.insert(this.rng.pick(ends), `${token} `)
    this.intent.tokens.set(token, block)
  }

  private createBlock(tree: LoroTree, parent: TreeID, device: number) {
    const count = tree.getNodeByID(parent)!.children()?.length ?? 0
    const node = tree.createNode(parent, this.rng.int(0, count))
    node.data.setContainer("src", new LoroText())
    this.intent.blocks.push(node.id)
    this.insertUnit(tree, node.id, device)
  }

  private createPage(tree: LoroTree, device: number) {
    const page = tree.createNode()
    page.data.set("name", `page ${device}.${this.seq++}`)
    this.intent.pages.push(page.id)
    this.createBlock(tree, page.id, device)
  }

  /** Applies one random user operation on a device's own replica. Returns false if nothing applicable was found. */
  apply(doc: LoroDoc, device: number, kind: OpKind): boolean {
    const tree = treeOf(doc)
    const { intent } = this
    if (kind !== "createPage" && !this.pickAlive(tree, intent.pages)) kind = "createPage"
    switch (kind) {
      case "insertText": {
        const block = this.pickAlive(tree, intent.blocks)
        if (!block) return false
        this.insertUnit(tree, block, device)
        break
      }
      case "deleteText": {
        const block = this.pickAlive(tree, intent.blocks)
        if (!block) return false
        const text = textOf(tree, block)
        const s = text.toString()
        const ends = unitEnds(s)
        const units = ends.length - 1
        if (units === 0) return false
        const k = this.rng.int(0, units - 1)
        const n = Math.min(this.rng.int(1, 3), units - k)
        const [from, to] = [ends[k]!, ends[k + n]!]
        for (const t of s.slice(from, to).match(TOKEN) ?? []) intent.deadTokens.add(t)
        text.delete(from, to - from)
        break
      }
      case "createBlock": {
        const parent = this.pickParent(tree)
        if (!parent) return false
        this.createBlock(tree, parent, device)
        break
      }
      case "deleteBlock": {
        const block = this.pickAlive(tree, intent.blocks)
        if (!block) return false
        tree.delete(block)
        intent.explicitlyDeleted.add(block)
        break
      }
      case "moveBlock": {
        const block = this.pickAlive(tree, intent.blocks)
        const parent = this.pickParent(tree)
        if (!block || !parent || isAncestor(tree, block, parent)) return false
        const node = tree.getNodeByID(block)!
        const siblings = tree.getNodeByID(parent)!.children()?.length ?? 0
        const same = node.parent()?.id === parent
        try {
          tree.move(block, parent, this.rng.int(0, same ? siblings - 1 : siblings))
        } catch {
          intent.counts.rejected++
          return false
        }
        break
      }
      case "renamePage": {
        const page = this.pickAlive(tree, intent.pages)
        if (!page) return false
        tree.getNodeByID(page)!.data.set("name", `page ${device}.${this.seq++}`)
        break
      }
      case "createPage":
        this.createPage(tree, device)
        break
      case "deletePage": {
        const page = this.pickAlive(tree, intent.pages)
        if (!page) return false
        tree.delete(page)
        intent.explicitlyDeleted.add(page)
        break
      }
    }
    intent.counts[kind]++
    doc.commit()
    return true
  }

  pickKind(): OpKind | "cyclePair" {
    let r = this.rng.next()
    for (const [kind, p] of MIX) {
      if (r < p) return kind
      r -= p
    }
    return "insertText"
  }

  /**
   * Two devices concurrently move X under Y and Y under X. Each move is legal on its own replica;
   * together they would form a cycle, which the CRDT has to resolve identically everywhere.
   */
  cyclePair(a: LoroDoc, b: LoroDoc): boolean {
    const [ta, tb] = [treeOf(a), treeOf(b)]
    const pick = () => {
      const id = this.pickAlive(ta, this.intent.blocks)
      return id && alive(tb, id) ? id : undefined
    }
    for (let i = 0; i < 8; i++) {
      const [x, y] = [pick(), pick()]
      if (!x || !y || x === y) continue
      if (isAncestor(ta, x, y) || isAncestor(ta, y, x) || isAncestor(tb, x, y) || isAncestor(tb, y, x)) continue
      ta.move(x, y, 0)
      tb.move(y, x, 0)
      a.commit()
      b.commit()
      this.intent.counts.cyclePairs++
      this.intent.counts.moveBlock += 2
      return true
    }
    return false
  }
}
