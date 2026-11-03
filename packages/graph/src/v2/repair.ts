import { Option, Schema } from "effect"
import { PageId, type Page } from "@seqno/domain"
import { setProp } from "../tree.ts"
import {
  isWithin,
  lastPlacement,
  moveUnder,
  placeAll,
  rounds,
  unseenBy,
  unseenSince,
  usable,
  wasOf,
  type Placing,
  type Spot as Place,
  type Unseen,
} from "../unseen.ts"
import {
  AT,
  REF,
  TRASHED,
  ensurePageData,
  pageOfTree,
  parseKey,
  resolvePage,
  spotOf,
  type Spot,
} from "./layout.ts"
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

interface Unit {
  readonly home: Spot
  readonly at: Spot
}

type End =
  | { readonly _tag: "Node"; readonly k: Spot }
  | { readonly _tag: "Page"; readonly page: PageId }

interface Chain {
  readonly units: ReadonlyArray<Unit>
  readonly end: End
}

const decodePageId = Schema.decodeUnknownOption(PageId)

const chainOf = (trees: Trees, spot: Spot): Option.Option<Chain> => {
  const units: Array<Unit> = []
  const seen = new Set<string>()
  let cursor = homeOf(trees, spot)
  for (;;) {
    if (seen.has(cursor.key)) return Option.none()
    seen.add(cursor.key)
    const at = placementOf(trees, cursor)
    units.push({ home: cursor, at })
    const parent = at.node.parent()
    if (parent === undefined) {
      const { trashed } = trees.listing()
      if (Option.isSome(resolvePage(trees.listing(), at.page)) || !trashed.has(at.page)) {
        return Option.none()
      }
      return Option.some({ units, end: { _tag: "Page", page: at.page } })
    }
    const above = spotOf(at.page, parent)
    if (trees.facts(above).trash) return Option.some({ units, end: { _tag: "Node", k: at } })
    cursor = homeOf(trees, above)
  }
}

const nodesOf = (unit: Unit) =>
  sameSpot(unit.home, unit.at) ? [unit.home.node] : [unit.home.node, unit.at.node]

const placeAt = (trees: Trees, unit: Unit, page: PageId, spot: Place, index: number) => {
  const { home, at } = unit
  const tree = trees.tree(page)
  if (home.page === page) {
    if (spot.parent !== undefined && isWithin(tree.getNodeByID(spot.parent), home.node)) return
    tree.move(home.node.id, spot.parent, index)
    if (!sameSpot(home, at)) {
      trees.tree(at.page).move(at.node.id, trees.trash(at.page).id, 0)
      home.node.data.delete(AT)
    }
    return
  }
  if (at.page === page) {
    moveUnder(tree, at.node, spot.parent, index)
    return
  }
  const node = tree.createNode(spot.parent, index)
  node.data.set(REF, home.key)
  home.node.data.set(AT, spotOf(page, node).key)
  trees.markMoved(home)
  if (!sameSpot(home, at)) trees.tree(at.page).move(at.node.id, trees.trash(at.page).id, 0)
}

const rescue = (
  trees: Trees,
  unseen: Unseen,
  k: Spot,
  chains: ReadonlyArray<Chain>,
): ReadonlyArray<Placing> => {
  const { doc } = trees
  const by = k.node.getLastMoveId()
  if (by === undefined) return []
  const tree = trees.tree(k.page)
  const missed = (unit: Unit) => unseenBy(doc, unseen, nodesOf(unit), by)
  if (missed({ home: homeOf(trees, k), at: k })) {
    const to = Option.orElse(lastPlacement(doc, tree, unseen, k.node, by), () => wasOf(k.node))
    return Option.match(
      Option.filter(to, (spot) => usable(tree, spot)),
      {
        onNone: () => [],
        onSome: (spot) => [
          {
            node: k.node,
            spot,
            path: [],
            put: (index: number) => moveUnder(tree, k.node, spot.parent, index),
          },
        ],
      },
    )
  }
  const was = Option.filter(wasOf(k.node), (spot) => usable(tree, spot))
  if (Option.isNone(was)) return []
  const placings = new Map<string, Placing>()
  for (const { units } of chains) {
    for (let at = units.length - 2; at >= 0; at--) {
      const unit = units[at]
      if (unit === undefined || !missed(unit)) continue
      const path = units.slice(at, -1).map((one) => one.at.node.fractionalIndex() ?? "")
      placings.set(unit.home.key, {
        node: unit.at.node,
        spot: was.value,
        path: path.toReversed(),
        put: (index) => placeAt(trees, unit, k.page, was.value, index),
      })
      break
    }
  }
  return [...placings.values()]
}

const rescueOnce = (trees: Trees, unseen: Unseen): boolean => {
  const killed = new Map<string, { k: Spot; chains: Array<Chain> }>()
  const pages = new Map<PageId, Array<Chain>>()
  for (const [id, { root }] of unseen.nodes) {
    const page = pageOfTree(root)
    if (Option.isNone(page)) continue
    Option.map(
      Option.flatMap(
        Option.filter(
          Option.map(trees.node(page.value, id), (node) => spotOf(page.value, node)),
          (spot) => !trees.facts(spot).trash,
        ),
        (spot) => chainOf(trees, spot),
      ),
      (chain) => {
        if (chain.end._tag === "Page") {
          pages.set(chain.end.page, [...(pages.get(chain.end.page) ?? []), chain])
          return
        }
        const { k } = chain.end
        const known = killed.get(k.key)
        if (known === undefined) killed.set(k.key, { k, chains: [chain] })
        else known.chains.push(chain)
      },
    )
  }
  const placings = new Map<PageId, Array<Placing>>()
  for (const { k, chains } of killed.values()) {
    placings.set(k.page, [...(placings.get(k.page) ?? []), ...rescue(trees, unseen, k, chains)])
  }
  let repaired = false
  for (const [page, onPage] of placings) {
    if (onPage.length === 0) continue
    placeAll(trees.tree(page), onPage)
    repaired = true
  }
  const flags = unseen.keys.get(TRASHED)
  for (const [page, chains] of pages) {
    const flag = flags?.get(page)
    if (flag === undefined || Option.isNone(decodePageId(page))) continue
    const missed = chains.some(({ units }) =>
      units.some((unit) => unseenBy(trees.doc, unseen, nodesOf(unit), flag.id)),
    )
    if (!missed) continue
    trees.dir.trashed.delete(page)
    repaired = true
  }
  if (repaired) trees.relist()
  return repaired
}

export const repairUnseen = (trees: Trees): boolean =>
  Option.match(unseenSince(trees.doc, new Set([TRASHED])), {
    onNone: () => false,
    onSome: (unseen) => rounds(() => rescueOnce(trees, unseen)),
  })
