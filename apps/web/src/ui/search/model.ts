import { normalizePageName, type Block, type Page } from "@seqno/domain"
import type { PageStat } from "@seqno/rpc"
import { crumbLabel, listValues } from "../pages/model.ts"

export type PageName = Pick<Page, "name" | "title"> & { readonly tag?: boolean }

export type Filter = "current-page" | "nodes" | "codes" | "commands" | "files" | "themes"

export type FileTarget =
  | { readonly _tag: "Page"; readonly name: string }
  | { readonly _tag: "Asset"; readonly url: string }

export interface GraphFile {
  readonly path: string
  readonly target: FileTarget
}

export interface PaletteCommand {
  readonly id: string
  readonly label: string
  readonly keys: ReadonlyArray<ReadonlyArray<string>>
}

export interface ThemeOption {
  readonly name: string
  readonly url: string | null
  readonly detail: string
  readonly selected: boolean
}

export type Item =
  | { readonly _tag: "Create"; readonly title: string }
  | { readonly _tag: "Page"; readonly page: PageName }
  | {
      readonly _tag: "Block"
      readonly block: Block
      readonly page: Page
      readonly crumbs: ReadonlyArray<string>
    }
  | { readonly _tag: "Command"; readonly command: PaletteCommand }
  | { readonly _tag: "Filter"; readonly filter: Filter; readonly text: string }
  | { readonly _tag: "Theme"; readonly theme: ThemeOption }
  | { readonly _tag: "File"; readonly file: GraphFile }

export type GroupId =
  | "create"
  | "current-page"
  | "nodes"
  | "recent"
  | "codes"
  | "commands"
  | "files"
  | "themes"
  | "filters"

export interface Group {
  readonly id: GroupId
  readonly title: string | null
  readonly items: ReadonlyArray<Item>
  readonly total: number
}

export interface Hits {
  readonly pages: ReadonlyArray<Page>
  readonly blocks: ReadonlyArray<Block>
  readonly ancestors: ReadonlyArray<Block>
}

export const noHits: Hits = { pages: [], blocks: [], ancestors: [] }

const nodesShown = 10
const filesShown = 99
const recentShown = 5
const shownPerGroup = 5

const terms = (query: string) =>
  query
    .trim()
    .split(/\s+/)
    .filter((term) => term !== "")

const escape = (term: string) => term.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

export interface Part {
  readonly text: string
  readonly mark: boolean
}

export const highlight = (text: string, query: string): ReadonlyArray<Part> => {
  const words = terms(query)
  if (words.length === 0) return [{ text, mark: false }]
  const pattern = new RegExp(words.map(escape).join("|"), "giu")
  const parts: Array<Part> = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const from = match.index
    if (from > at) parts.push({ text: text.slice(at, from), mark: false })
    parts.push({ text: match[0], mark: true })
    at = from + match[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at), mark: false })
  return parts
}

const crumbsOf = (block: Block, page: Page, ancestors: ReadonlyMap<string, Block>) => {
  const trail: Array<string> = []
  for (
    let at = block.parentId === null ? undefined : ancestors.get(block.parentId);
    at !== undefined;
    at = at.parentId === null ? undefined : ancestors.get(at.parentId)
  ) {
    trail.unshift(crumbLabel(at.text))
  }
  return [page.title, ...trail]
}

export const blockHits = (hits: Hits, pages: ReadonlyArray<Page>) => {
  const byId = new Map(pages.map((page) => [page.id, page]))
  const ancestors = new Map(hits.ancestors.map((block) => [block.id, block]))
  return hits.blocks.flatMap((block) => {
    const page = byId.get(block.pageId)
    return page === undefined ? [] : [{ block, page, crumbs: crumbsOf(block, page, ancestors) }]
  })
}

const matches = (page: PageName, words: ReadonlyArray<string>) =>
  words.every((word) => page.title.toLowerCase().includes(word.toLowerCase()))

const filterLabels: Readonly<Record<Filter, string>> = {
  "current-page": "Current page",
  nodes: "Nodes",
  codes: "Code",
  commands: "Commands",
  files: "Files",
  themes: "Themes",
}

const filterTexts: Readonly<Record<Filter, string>> = {
  "current-page": "Search only current page",
  nodes: "Search only nodes",
  codes: "Search only codes",
  commands: "Search only commands",
  files: "Search only files",
  themes: "Search only themes",
}

export const filterLabel = (filter: Filter) => filterLabels[filter]

export const filterText = (filter: Filter) => filterTexts[filter]

const wordsMatch = (text: string, words: ReadonlyArray<string>) => {
  const lower = text.toLowerCase()
  return words.every((word) => lower.includes(word.toLowerCase()))
}

const byMatch = <A>(items: ReadonlyArray<A>, query: string, textOf: (item: A) => string) => {
  const words = terms(query)
  if (words.length === 0) return items
  const wanted = query.trim().toLowerCase()
  const at = (item: A) => {
    const found = textOf(item).toLowerCase().indexOf(wanted)
    return found === -1 ? Number.MAX_SAFE_INTEGER : found
  }
  return items
    .filter((item) => wordsMatch(textOf(item), words))
    .toSorted((left, right) => at(left) - at(right))
}

const filterQuery = (query: string) => {
  const slash = query.lastIndexOf("/")
  return slash === -1 ? null : { before: query.slice(0, slash), after: query.slice(slash + 1) }
}

export const groupsOf = (input: {
  readonly query: string
  readonly hits: Hits
  readonly pages: ReadonlyArray<Page>
  readonly referenced: ReadonlyArray<PageName>
  readonly stats: ReadonlyArray<PageStat>
  readonly expanded: ReadonlySet<GroupId>
  readonly filter?: Filter | null
  readonly filters?: ReadonlyArray<Filter>
  readonly commands?: ReadonlyArray<PaletteCommand>
  readonly themes?: ReadonlyArray<ThemeOption>
  readonly pageHits?: Hits
  readonly codeHits?: Hits
  readonly files?: ReadonlyArray<GraphFile>
}): ReadonlyArray<Group> => {
  const { query, hits, pages, referenced, stats, expanded } = input
  const filter = input.filter ?? null
  const words = terms(query)
  const name = normalizePageName(query)
  const exists =
    name === "" ||
    referenced.some((page) => page.name === name) ||
    pages.some(
      (page) =>
        page.name === name ||
        listValues(page.props["alias"] ?? "").some((alias) => normalizePageName(alias) === name),
    )
  const named = referenced
    .filter((page) => words.length > 0 && matches(page, words))
    .toSorted(
      (left, right) =>
        Number(right.name === name) - Number(left.name === name) ||
        left.name.indexOf(name) - right.name.indexOf(name) ||
        left.name.length - right.name.length,
    )
  const nodes: ReadonlyArray<Item> = [
    ...named.map((page): Item => ({ _tag: "Page", page })),
    ...hits.pages.map((page): Item => ({ _tag: "Page", page })),
    ...blockHits(hits, pages).map((hit): Item => ({ _tag: "Block", ...hit })),
  ]
  const onPage = blockHits(input.pageHits ?? noHits, pages).map((hit): Item => ({
    _tag: "Block",
    ...hit,
  }))
  const updated = new Map(stats.map((stat) => [stat.pageId, stat.updated ?? 0]))
  const recent = pages
    .filter((page) => updated.has(page.id) && matches(page, words))
    .toSorted((left, right) => (updated.get(right.id) ?? 0) - (updated.get(left.id) ?? 0))
    .map((page): Item => ({ _tag: "Page", page }))
  const commands = byMatch(input.commands ?? [], query, (command) => command.label).map(
    (command): Item => ({ _tag: "Command", command }),
  )
  const codes = blockHits(input.codeHits ?? noHits, pages).map((hit): Item => ({
    _tag: "Block",
    ...hit,
  }))
  const files = byMatch(input.files ?? [], query, (file) => file.path)
    .slice(0, filesShown)
    .map((file): Item => ({ _tag: "File", file }))
  const themes = byMatch(input.themes ?? [], query, (theme) => theme.name).map((theme): Item => ({
    _tag: "Theme",
    theme,
  }))
  const split = filterQuery(query)
  const filters = byMatch(
    (input.filters ?? []).map((one) => ({ filter: one, text: filterText(one) })),
    split?.after ?? "",
    (one) => one.text,
  ).map((one): Item => ({ _tag: "Filter", ...one }))
  const group = (id: GroupId, title: string, items: ReadonlyArray<Item>, shown: number): Group => ({
    id,
    title,
    items: filter !== null || expanded.has(id) ? items : items.slice(0, shown),
    total: items.length,
  })
  const create: Group = {
    id: "create",
    title: null,
    items: exists ? [] : [{ _tag: "Create", title: query.trim() }],
    total: 1,
  }
  const ordered: ReadonlyArray<Group> = query.startsWith("/")
    ? [group("filters", "Filters", filters, shownPerGroup)]
    : split !== null
      ? [
          group("nodes", "Nodes", nodes, nodesShown),
          group("files", "Files", files, shownPerGroup),
          create,
          group("filters", "Filters", filters, shownPerGroup),
        ]
      : filter === "nodes"
        ? [
            group("current-page", "Current page", onPage, shownPerGroup),
            group("nodes", "Nodes", nodes, nodesShown),
            create,
          ]
        : filter === "current-page"
          ? [group("current-page", "Current page", onPage, shownPerGroup)]
          : filter === "codes"
            ? [group("codes", "Code", codes, shownPerGroup)]
            : filter === "files"
              ? [group("files", "Files", files, shownPerGroup)]
              : filter === "commands"
                ? [group("commands", "Commands", commands, shownPerGroup)]
                : filter === "themes"
                  ? [group("themes", "Themes", themes, shownPerGroup)]
                  : words.length === 0
                    ? [group("recent", "Recently updated", recent, recentShown)]
                    : [
                        group("nodes", "Nodes", nodes, nodesShown),
                        group("recent", "Recently updated", recent, recentShown),
                        group("commands", "Commands", commands, shownPerGroup),
                        group("files", "Files", files, shownPerGroup),
                        create,
                        group("filters", "Filters", filters, shownPerGroup),
                      ]
  return withCreateAfterFirstMatch(ordered.filter((one) => one.items.length > 0))
}

const isMatch = (item: Item) => item._tag === "Page" || item._tag === "Block"

const withCreateAfterFirstMatch = (groups: ReadonlyArray<Group>): ReadonlyArray<Group> => {
  const create = groups.find((group) => group.id === "create")
  const first = groups.find((group) => group.items.some(isMatch))
  if (create === undefined || first === undefined) return groups
  return groups.flatMap((group) => {
    if (group.id === "create") return []
    if (group !== first) return [group]
    const at = group.items.findIndex(isMatch) + 1
    return [
      { ...group, items: [...group.items.slice(0, at), ...create.items, ...group.items.slice(at)] },
    ]
  })
}

export const itemKey = (item: Item) => {
  switch (item._tag) {
    case "Create":
      return "create"
    case "Page":
      return `page:${item.page.name}`
    case "Block":
      return `block:${item.block.id}`
    case "Command":
      return `command:${item.command.id}`
    case "Filter":
      return `filter:${item.filter}`
    case "Theme":
      return `theme:${item.theme.url ?? ""}`
    case "File":
      return `file:${item.file.path}`
  }
}
