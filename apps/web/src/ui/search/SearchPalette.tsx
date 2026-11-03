import {
  RegistryContext,
  useAtom,
  useAtomMount,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react"
import {
  IconCode,
  IconCommand,
  IconFile,
  IconHash,
  IconPalette,
  IconPointFilled,
  IconSquareCheck,
  IconSquarePlus2,
  IconX,
} from "@tabler/icons-react"
import { useMatchRoute, useRouter } from "@tanstack/react-router"
import { Exit, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  Fragment,
  useContext,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { logseq } from "@seqno/dom"
import { blockRefId, type BlockId, type Page } from "@seqno/domain"
import { chosenThemes, pluginCommands, runtimeThemes, type PluginTheme } from "@seqno/plugins"
import type { PageStat } from "@seqno/rpc"
import {
  allPages,
  assetFiles,
  createPage,
  openGraph,
  pageNamed,
  resolvedTheme,
  rightSidebar,
  searchOpen,
  type SidebarItem,
} from "../../atoms.ts"
import { openPdf } from "../assets.ts"
import { pageStats, referencedOnly } from "../pages/atoms.ts"
import { applyTheme, themeChosen } from "../plugins/PluginsDialog.tsx"
import {
  builtInCommands,
  byUse,
  commandHistory,
  pluginPaletteCommands,
  used,
  type RunnableCommand,
} from "../shell/commands.ts"
import {
  codeHits,
  isSearchKey,
  pageFiles,
  pageHits,
  paletteFilter,
  paletteHits,
  paletteKey,
  paletteQuery,
  searchShortcut,
} from "./atoms.ts"
import {
  filterLabel,
  groupsOf,
  highlight,
  itemKey,
  noHits,
  type Filter,
  type GraphFile,
  type Group,
  type Item,
  type ThemeOption,
} from "./model.ts"
import { Keys } from "../shell/Keys.tsx"
import { onMac } from "../shell/shortcuts.ts"
import searchCss from "./search.css?inline"

const mod = onMac ? "⌘" : "Ctrl"

const noStats: ReadonlyArray<PageStat> = []

const Marked = ({ text, query }: { readonly text: string; readonly query: string }) =>
  highlight(text, query).map((part, at) =>
    part.mark ? (
      <mark key={at} {...logseq("seqno-palette-mark")}>
        {part.text}
      </mark>
    ) : (
      <Fragment key={at}>{part.text}</Fragment>
    ),
  )

const filterIcons: Readonly<Record<Filter, ReactNode>> = {
  "current-page": <IconFile size={14} aria-hidden />,
  nodes: <IconPointFilled size={14} aria-hidden />,
  codes: <IconCode size={14} aria-hidden />,
  commands: <IconCommand size={14} aria-hidden />,
  files: <IconFile size={14} aria-hidden />,
  themes: <IconPalette size={14} aria-hidden />,
}

const iconOf = (item: Item): ReactNode => {
  switch (item._tag) {
    case "Create":
      return <IconSquarePlus2 size={14} aria-hidden />
    case "Page":
      return item.page.tag === true ? (
        <IconHash size={14} aria-hidden />
      ) : (
        <IconFile size={14} aria-hidden />
      )
    case "Block":
      return <IconPointFilled size={14} aria-hidden />
    case "Command":
      return <IconCommand size={14} aria-hidden />
    case "Filter":
      return filterIcons[item.filter]
    case "File":
      return <IconFile size={14} aria-hidden />
    case "Theme":
      return item.theme.selected ? (
        <IconSquareCheck size={14} aria-hidden />
      ) : (
        <IconPalette size={14} aria-hidden />
      )
  }
}

const textOf = (item: Item, query: string): ReactNode => {
  switch (item._tag) {
    case "Create":
      return (
        <>
          Create page
          <span className="seqno-palette-detail"> — Create page called '{item.title}'</span>
        </>
      )
    case "Page":
      return <Marked text={item.page.title} query={query} />
    case "Block":
      return <Marked text={item.block.text} query={query} />
    case "Command":
      return <Marked text={item.command.label} query={query} />
    case "File":
      return <Marked text={item.file.path} query={query} />
    case "Filter":
      return (
        <>
          {item.text}
          <span className="seqno-palette-detail"> — Add filter to search</span>
        </>
      )
    case "Theme":
      return (
        <>
          <Marked text={item.theme.name} query={query} />
          <span className="seqno-palette-detail"> — {item.theme.detail}</span>
        </>
      )
  }
}

const stepsOf = (combo: ReadonlyArray<string>) =>
  combo.reduce<ReadonlyArray<ReadonlyArray<string>>>(
    (steps, key) =>
      key === "then" ? [...steps, []] : [...steps.slice(0, -1), [...(steps.at(-1) ?? []), key]],
    [[]],
  )

const Shortcut = ({ combos }: { readonly combos: ReadonlyArray<ReadonlyArray<string>> }) =>
  combos.length === 0 ? null : (
    <span className="seqno-palette-shortcut">
      {combos.map((combo, at) => (
        <Fragment key={combo.join(" ")}>
          {at === 0 ? null : <span className="seqno-palette-shortcut-or" />}
          {stepsOf(combo).map((step, position) => (
            <Fragment key={position}>
              {position === 0 ? null : <span className="seqno-palette-shortcut-then">then</span>}
              <Keys keys={step} framed />
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  )

const Row = ({ item, query }: { readonly item: Item; readonly query: string }) => (
  <>
    {item._tag === "Block" ? (
      <span className="seqno-palette-crumbs">
        {item.crumbs.map((crumb, at) => (
          <Fragment key={at}>
            {at === 0 ? null : <span className="seqno-palette-crumbs-separator">/</span>}
            <span className="seqno-palette-crumb">{crumb}</span>
          </Fragment>
        ))}
      </span>
    ) : null}
    <span className="seqno-palette-line">
      <span className="seqno-palette-tile">{iconOf(item)}</span>
      <span className="seqno-palette-text">{textOf(item, query)}</span>
      {item._tag === "Command" ? <Shortcut combos={item.command.keys} /> : null}
    </span>
  </>
)

const refOf = (item: Item) =>
  item._tag === "Block"
    ? `((${blockRefId(item.block)}))`
    : item._tag === "Page"
      ? `[[${item.page.title}]]`
      : null

const copyRef = (item: Item) => {
  const ref = refOf(item)
  if (ref !== null) void navigator.clipboard.writeText(ref).catch(() => undefined)
}

const useCurrentPage = (): Page | undefined => {
  const onPage = useMatchRoute()({ to: "/page/$name" })
  const named = useAtomValue(pageNamed(onPage === false ? "" : onPage.name))
  return Option.getOrUndefined(AsyncResult.getOrElse(named, () => Option.none()))
}

const actionOf = (item: Item) => {
  switch (item._tag) {
    case "Create":
      return "Create"
    case "Command":
      return "Trigger"
    case "Filter":
      return "Filter"
    case "Theme":
      return "Apply theme"
    case "File":
      return "Open"
    case "Page":
    case "Block":
      return null
  }
}

const Tip = ({ filter }: { readonly filter: Filter | null }) => {
  const [slash] = useState(() => Math.random() < 0.5)
  return (
    <div className="seqno-palette-tip">
      <span className="seqno-palette-tip-title">Tip:</span>
      <span className="seqno-palette-tip-text">
        {filter !== null ? (
          <>
            Press <Keys keys={["escape"]} /> to clear search filter
          </>
        ) : slash ? (
          <>
            Type <Keys keys={["/"]} /> to filter search results
          </>
        ) : (
          <>
            Press <Keys keys={["shift", "enter"]} /> to open a result in the sidebar
          </>
        )}
      </span>
    </div>
  )
}

const themeOptions = (
  themes: ReadonlyArray<PluginTheme>,
  chosen: Parameters<typeof themeChosen>[0],
  mode: "light" | "dark",
): ReadonlyArray<ThemeOption & { readonly entry: PluginTheme | null }> => [
  {
    name: "Logseq default theme",
    url: null,
    detail: `${mode} #logseq-classic-theme`,
    selected: themeChosen(chosen, null),
    entry: null,
  },
  ...themes.map((entry) => ({
    name: entry.name,
    url: entry.url,
    detail: `${entry.mode ?? mode} #${entry.pid}`,
    selected: themeChosen(chosen, entry),
    entry,
  })),
]

const Palette = ({
  onRoute,
  onClose,
}: {
  readonly onRoute: boolean
  readonly onClose: () => void
}) => {
  const registry = useContext(RegistryContext)
  const [query, setQuery] = useAtom(paletteQuery)
  const [chosenFilter, setFilter] = useAtom(paletteFilter)
  const currentPage = useCurrentPage()
  const filter = chosenFilter === "current-page" && currentPage === undefined ? null : chosenFilter
  const hits = AsyncResult.getOrElse(useAtomValue(paletteHits), () => noHits)
  const onPage = AsyncResult.getOrElse(
    useAtomValue(pageHits(currentPage?.id ?? null)),
    () => noHits,
  )
  const pages = useAtomValue(allPages)
  const code = AsyncResult.getOrElse(useAtomValue(codeHits), () => noHits)
  const files: ReadonlyArray<GraphFile> = [
    ...AsyncResult.getOrElse(useAtomValue(pageFiles), () => []).map((file): GraphFile => ({
      path: file.path,
      target: { _tag: "Page", name: file.name },
    })),
    ...useAtomValue(assetFiles).map((asset): GraphFile => ({
      path: asset.path,
      target: { _tag: "Asset", url: asset.url },
    })),
  ]
  const stats = AsyncResult.getOrElse(useAtomValue(pageStats), () => noStats)
  const history = useAtomValue(commandHistory)
  const plugins = useAtomValue(pluginCommands)
  const themes = themeOptions(
    useAtomValue(runtimeThemes),
    useAtomValue(chosenThemes),
    useAtomValue(resolvedTheme),
  )
  const setOpen = useAtomSet(searchOpen)
  const updateSidebar = useAtomSet(rightSidebar)
  const create = useAtomSet(createPage, { mode: "promiseExit" })
  const router = useRouter()
  const [expanded, setExpanded] = useState<ReadonlySet<Group["id"]>>(new Set())
  const [active, setActive] = useState({ query, filter, index: 0 })
  const returnTo = useRef<HTMLElement | null>(null)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const ids = useId()
  const referenced = useAtomValue(referencedOnly)
  const commands: ReadonlyArray<RunnableCommand> = byUse(
    [...builtInCommands(registry, router), ...pluginPaletteCommands(registry, plugins)],
    history,
  )
  const groups = groupsOf({
    query,
    hits,
    pages,
    referenced,
    stats,
    expanded,
    filter,
    filters: [
      ...(currentPage === undefined ? [] : ["current-page" as const]),
      "nodes",
      "codes",
      "commands",
      "files",
      "themes",
    ],
    commands,
    themes,
    pageHits: onPage,
    codeHits: code,
    files,
  })
  const items = groups.flatMap((group) => group.items)
  const fresh = active.query === query && active.filter === filter
  const index = fresh ? Math.min(active.index, items.length - 1) : 0
  const current = items[index]
  const optionId = (at: number) => `${ids}-option-${at}`

  const choose = (at: number) => {
    setActive({ query, filter, index: at })
    document.getElementById(optionId(at))?.scrollIntoView({ block: "nearest" })
  }

  const goTo = (name: string, zoom: BlockId | null) => {
    setOpen(false)
    void router.navigate({
      to: "/page/$name",
      params: { name },
      search: zoom === null ? {} : { zoom },
      replace: onRoute,
    })
  }

  const toSidebar = (item: SidebarItem) => {
    updateSidebar({ _tag: "Open", item })
    onClose()
  }

  const narrow = (next: Filter | null, text: string) => {
    setFilter(next)
    setQuery(text)
    setExpanded(new Set())
    input.current?.focus()
  }

  const trigger = (id: string) => {
    const command = commands.find((one) => one.id === id)
    if (command === undefined) return
    dialog.current?.close()
    onClose()
    used(registry, id)
    command.run(returnTo.current)
  }

  const openFile = (file: GraphFile, sidebar: boolean) => {
    if (file.target._tag === "Page") {
      const name = file.target.name
      return sidebar ? toSidebar({ _tag: "Page", name }) : goTo(name, null)
    }
    onClose()
    if (file.path.toLowerCase().endsWith(".pdf")) openPdf(registry, `../${file.path}`)
    else window.open(file.target.url, "_blank", "noopener")
  }

  const open = async (item: Item, sidebar: boolean) => {
    switch (item._tag) {
      case "Command":
        return trigger(item.command.id)
      case "Filter": {
        const slash = query.lastIndexOf("/")
        return narrow(item.filter, slash === -1 ? query : query.slice(0, slash))
      }
      case "Theme": {
        const picked = themes.find((theme) => theme.url === item.theme.url)
        if (picked !== undefined) applyTheme(registry, picked.entry)
        return onClose()
      }
      case "Create": {
        const created = await create(item.title)
        if (Exit.isFailure(created)) return
        const name = created.value
        return sidebar ? toSidebar({ _tag: "Page", name }) : goTo(name, null)
      }
      case "File":
        return openFile(item.file, sidebar)
      case "Page":
        return sidebar
          ? toSidebar({ _tag: "Page", name: item.page.name })
          : goTo(item.page.name, null)
      case "Block":
        return sidebar
          ? toSidebar({ _tag: "Block", blockId: item.block.id })
          : goTo(item.page.name, item.block.id)
    }
  }

  const starts = groups.map((_, at) =>
    groups.slice(0, at).reduce((sum, group) => sum + group.items.length, 0),
  )
  const groupOf = (at: number) =>
    groups.find((group, position) => at < (starts[position] ?? 0) + group.items.length)

  const toggleGroup = (id: Group["id"]) =>
    setExpanded((now) => {
      const next = new Set(now)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const dismiss = () => {
    if (filter !== null) narrow(null, query)
    else if (query !== "") setQuery("")
    else onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = items.length
    const next = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")
    const previous = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")
    const narrowed = paletteKey(event)
    if (isSearchKey(event)) {
      event.preventDefault()
      onClose()
    } else if (narrowed !== undefined) {
      event.preventDefault()
      narrow(narrowed, "")
    } else if ((event.metaKey || event.ctrlKey) && event.key === "ArrowDown") {
      event.preventDefault()
      const group = groupOf(index)
      if (group !== undefined && group.total > 1) toggleGroup(group.id)
    } else if ((next || previous) && count > 0) {
      event.preventDefault()
      choose((index + (next ? 1 : count - 1)) % count)
    } else if (event.key === "Enter" && current !== undefined) {
      event.preventDefault()
      void open(current, event.shiftKey)
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "c" &&
      current !== undefined &&
      refOf(current) !== null &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      event.preventDefault()
      copyRef(current)
    }
  }

  const action = current === undefined ? null : actionOf(current)

  return (
    <dialog
      {...logseq("seqno-palette")}
      aria-label="Search"
      data-keeps-selection
      ref={(element) => {
        dialog.current = element
        if (element === null || element.open) return
        returnTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        element.showModal()
      }}
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <style href="seqno/search" precedence="pages">
        {searchCss}
      </style>
      <div className="seqno-palette-input">
        <input
          ref={input}
          {...logseq("seqno-palette-search")}
          type="search"
          aria-label="Search"
          placeholder="What are you looking for?"
          autoComplete="off"
          spellCheck={false}
          value={query}
          aria-controls={`${ids}-results`}
          aria-activedescendant={current === undefined ? undefined : optionId(index)}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="seqno-palette-results" id={`${ids}-results`}>
        {filter === null ? null : (
          <div className="seqno-palette-filter">
            <span>Search only:</span>
            <span>{filterLabel(filter)}</span>
            <button
              type="button"
              aria-label="Clear filter"
              className="seqno-palette-filter-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => narrow(null, query)}
            >
              <IconX size={18} aria-hidden />
            </button>
          </div>
        )}
        {groups.map((group, position) => {
          const start = starts[position] ?? 0
          return (
            <div key={group.id} className="seqno-palette-group" data-group={group.id}>
              {group.title === null ? null : (
                <div className="seqno-palette-group-head">
                  <span className="seqno-palette-group-title">{group.title}</span>
                  <span className="seqno-palette-group-count">{group.total}</span>
                  {filter === null &&
                  (group.total > group.items.length || expanded.has(group.id)) ? (
                    <button
                      type="button"
                      {...logseq("seqno-palette-more")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <span>{expanded.has(group.id) ? "Show less" : "Show more"}</span>
                      <span>{mod}</span>
                      <span>↓</span>
                    </button>
                  ) : null}
                </div>
              )}
              <div
                {...logseq("seqno-palette-list")}
                role="listbox"
                aria-label={group.title ?? "Create page"}
              >
                {group.items.map((item, at) => (
                  <div
                    key={itemKey(item)}
                    id={optionId(start + at)}
                    role="option"
                    aria-selected={start + at === index}
                    className="seqno-palette-item"
                    data-kind={item._tag}
                    onMouseMove={() => {
                      if (start + at !== index) setActive({ query, filter, index: start + at })
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => void open(item, event.shiftKey)}
                  >
                    <Row item={item} query={query} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div {...logseq("seqno-palette-footer")}>
        <Tip filter={filter} />
        {current === undefined ? null : (
          <div className="seqno-palette-actions">
            {action !== null ? (
              <button
                type="button"
                {...logseq("seqno-palette-action")}
                data-active
                onClick={() => void open(current, false)}
              >
                <span>{action}</span>
                <Keys keys={["enter"]} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  {...logseq("seqno-palette-action")}
                  onClick={() => void open(current, false)}
                >
                  <span>Open</span>
                  <Keys keys={["enter"]} />
                </button>
                <button
                  type="button"
                  {...logseq("seqno-palette-action")}
                  onClick={() => void open(current, true)}
                >
                  <span>Open in sidebar</span>
                  <Keys keys={["shift", "enter"]} />
                </button>
                <button
                  type="button"
                  {...logseq("seqno-palette-action")}
                  onClick={() => copyRef(current)}
                >
                  <span>Copy ref</span>
                  <Keys keys={["mod", "c"]} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </dialog>
  )
}

export const SearchPalette = () => {
  useAtomMount(searchShortcut)
  const graph = useAtomValue(openGraph)
  const [open, setOpen] = useAtom(searchOpen)
  const matchRoute = useMatchRoute()
  const router = useRouter()
  const onRoute = matchRoute({ to: "/search" }) !== false
  if (!AsyncResult.isSuccess(graph) || !(open || onRoute)) return null
  const close = () => {
    setOpen(false)
    if (!onRoute) return
    if (router.history.canGoBack()) router.history.back()
    else void router.navigate({ to: "/" })
  }
  return <Palette onRoute={onRoute} onClose={close} />
}
