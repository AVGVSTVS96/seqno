import { Option } from "effect"
import type { Page, PageId } from "@seqno/domain"
import { setProp } from "../tree.ts"
import { AT, ensurePageData, parseKey, spotOf, type Spot } from "./layout.ts"
import { homeOf, locate, placementOf, sameSpot, type Located, type Trees } from "./outline.ts"

export const repairNames = (trees: Trees, touched: Iterable<PageId>): boolean => {
  const pages = trees.listing().live
  const names = new Set<string>()
  for (const id of touched)
    Option.map(Option.fromUndefinedOr(pages.get(id)), (page) => names.add(page.name))
  if (names.size === 0) return false
  const groups = new Map<string, Array<Page>>()
  for (const page of pages.values()) {
    if (!names.has(page.name)) continue
    groups.set(page.name, [...(groups.get(page.name) ?? []), page])
  }
  let repaired = false
  for (const group of groups.values()) {
    const [winner, ...losers] = group.toSorted((a, b) => (a.id < b.id ? -1 : 1))
    if (winner === undefined || losers.length === 0) continue
    const kept = new Set(Object.keys(winner.props))
    for (const loser of losers) {
      trees.dir.merged.set(loser.id, winner.id)
      for (const [key, value] of Object.entries(loser.props)) {
        if (kept.has(key)) continue
        kept.add(key)
        setProp(ensurePageData(trees.dir, winner.id), key, value)
      }
    }
    repaired = true
  }
  if (repaired) trees.relist()
  return repaired
}

const cut = (trees: Trees, homes: ReadonlyArray<Spot>) => {
  const [first] = homes.toSorted((a, b) => {
    const left = Option.getOrElse(trees.facts(a).id, () => "")
    const right = Option.getOrElse(trees.facts(b).id, () => "")
    return left < right ? -1 : left > right ? 1 : 0
  })
  if (first === undefined) return
  const at = placementOf(trees, first)
  if (!sameSpot(at, first)) {
    trees.tree(at.page).move(at.node.id, trees.trash(at.page).id, 0)
    first.node.data.delete(AT)
  }
  trees.tree(first.page).move(first.node.id)
}

export const repairCycles = (trees: Trees, spots: Iterable<Spot>): boolean => {
  if (trees.dir.moved.size === 0) return false
  let memo: Located = new Map()
  let repaired = false
  for (const spot of spots) {
    const where = locate(trees, homeOf(trees, spot), memo)
    if (where._tag !== "Cycle") continue
    cut(trees, where.homes)
    memo = new Map()
    repaired = true
  }
  return repaired
}

export const spotsOf = (trees: Trees, keys: Iterable<string>): ReadonlyArray<Spot> =>
  [...keys].flatMap((key) =>
    Option.toArray(
      Option.flatMap(parseKey(key), ([page, id]) =>
        Option.map(trees.node(page, id), (node) => spotOf(page, node)),
      ),
    ),
  )

export const movedHomes = (trees: Trees): ReadonlyArray<Spot> =>
  spotsOf(trees, Object.keys(trees.dir.moved.toJSON()))
