import { useAtom, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconFile, IconHash, IconPointFilled, IconSquarePlus2 } from "@tabler/icons-react"
import { useMatchRoute, useRouter } from "@tanstack/react-router"
import { Exit } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Fragment, useId, useState, type KeyboardEvent, type ReactNode } from "react"
import type { BlockId } from "@seqno/domain"
import type { PageStat } from "@seqno/rpc"
import {
  allPages,
  createPage,
  openGraph,
  rightSidebar,
  searchOpen,
  type SidebarItem,
} from "../../atoms.ts"
import { pageStats, referencedOnly } from "../pages/atoms.ts"
import { isSearchKey, paletteHits, paletteQuery, searchShortcut } from "./atoms.ts"
import { groupsOf, highlight, itemKey, noHits, type Group, type Item } from "./model.ts"
import { Keys } from "../shell/Keys.tsx"
import { onMac } from "../shell/shortcuts.ts"
import searchCss from "./search.css?inline"

const mod = onMac ? "⌘" : "Ctrl"

const noStats: ReadonlyArray<PageStat> = []

const Marked = ({ text, query }: { readonly text: string; readonly query: string }) =>
  highlight(text, query).map((part, at) =>
    part.mark ? <mark key={at}>{part.text}</mark> : <Fragment key={at}>{part.text}</Fragment>,
  )

const iconOf = (item: Item): ReactNode =>
  item._tag === "Create" ? (
    <IconSquarePlus2 size={14} aria-hidden />
  ) : item._tag === "Page" ? (
    item.page.tag === true ? (
      <IconHash size={14} aria-hidden />
    ) : (
      <IconFile size={14} aria-hidden />
    )
  ) : (
    <IconPointFilled size={14} aria-hidden />
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
      <span className="seqno-palette-text">
        {item._tag === "Create" ? (
          <>
            Create page
            <span className="seqno-palette-detail"> — Create page called '{item.title}'</span>
          </>
        ) : item._tag === "Page" ? (
          <Marked text={item.page.title} query={query} />
        ) : (
          <Marked text={item.block.text} query={query} />
        )}
      </span>
    </span>
  </>
)

const refOf = (item: Item) =>
  item._tag === "Block"
    ? `((${item.block.id}))`
    : `[[${item._tag === "Page" ? item.page.title : item.title}]]`

const copyRef = (item: Item) =>
  void navigator.clipboard.writeText(refOf(item)).catch(() => undefined)

const Palette = ({
  onRoute,
  onClose,
}: {
  readonly onRoute: boolean
  readonly onClose: () => void
}) => {
  const [query, setQuery] = useAtom(paletteQuery)
  const hits = AsyncResult.getOrElse(useAtomValue(paletteHits), () => noHits)
  const pages = useAtomValue(allPages)
  const stats = AsyncResult.getOrElse(useAtomValue(pageStats), () => noStats)
  const setOpen = useAtomSet(searchOpen)
  const updateSidebar = useAtomSet(rightSidebar)
  const create = useAtomSet(createPage, { mode: "promiseExit" })
  const router = useRouter()
  const [expanded, setExpanded] = useState<ReadonlySet<Group["id"]>>(new Set())
  const [active, setActive] = useState({ query, index: 0 })
  const ids = useId()
  const referenced = useAtomValue(referencedOnly)
  const groups = groupsOf({ query, hits, pages, referenced, stats, expanded })
  const items = groups.flatMap((group) => group.items)
  const index = active.query === query ? Math.min(active.index, items.length - 1) : 0
  const current = items[index]
  const optionId = (at: number) => `${ids}-option-${at}`

  const choose = (at: number) => {
    setActive({ query, index: at })
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

  const open = async (item: Item, sidebar: boolean) => {
    if (item._tag === "Create") {
      const created = await create(item.title)
      if (Exit.isFailure(created)) return
      const name = created.value
      return sidebar ? toSidebar({ _tag: "Page", name }) : goTo(name, null)
    }
    if (item._tag === "Page") {
      return sidebar
        ? toSidebar({ _tag: "Page", name: item.page.name })
        : goTo(item.page.name, null)
    }
    return sidebar
      ? toSidebar({ _tag: "Block", blockId: item.block.id })
      : goTo(item.page.name, item.block.id)
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

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = items.length
    const next = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")
    const previous = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")
    if (isSearchKey(event)) {
      event.preventDefault()
      onClose()
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
      current._tag !== "Create" &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      event.preventDefault()
      copyRef(current)
    }
  }

  return (
    <dialog
      className="seqno-palette"
      aria-label="Search"
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) dialog.showModal()
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
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
        {groups.map((group, position) => {
          const start = starts[position] ?? 0
          return (
            <div key={group.id} className="seqno-palette-group" data-group={group.id}>
              {group.title === null ? null : (
                <div className="seqno-palette-group-head">
                  <span className="seqno-palette-group-title">{group.title}</span>
                  <span className="seqno-palette-group-count">{group.total}</span>
                  {group.total > group.items.length || expanded.has(group.id) ? (
                    <button
                      type="button"
                      className="seqno-palette-more"
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
              <div role="listbox" aria-label={group.title ?? "Create page"}>
                {group.items.map((item, at) => (
                  <div
                    key={itemKey(item)}
                    id={optionId(start + at)}
                    role="option"
                    aria-selected={start + at === index}
                    className="seqno-palette-item"
                    data-kind={item._tag}
                    onMouseMove={() => {
                      if (start + at !== index) setActive({ query, index: start + at })
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
      <div className="seqno-palette-footer">
        <div className="seqno-palette-tip">
          <span className="seqno-palette-tip-title">Tip:</span>
          <span className="seqno-palette-tip-text">
            Press <Keys keys={["shift", "enter"]} /> to open a result in the sidebar
          </span>
        </div>
        {current === undefined ? null : (
          <div className="seqno-palette-actions">
            {current._tag === "Create" ? (
              <button type="button" data-active onClick={() => void open(current, false)}>
                <span>Create</span>
                <Keys keys={["enter"]} />
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void open(current, false)}>
                  <span>Open</span>
                  <Keys keys={["enter"]} />
                </button>
                <button type="button" onClick={() => void open(current, true)}>
                  <span>Open in sidebar</span>
                  <Keys keys={["shift", "enter"]} combo={false} />
                </button>
                <button type="button" onClick={() => copyRef(current)}>
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
