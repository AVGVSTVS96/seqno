import { logseq } from "@seqno/dom"
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconCalendar,
  IconChalkboard,
  IconChevronRight,
  IconDots,
  IconFile,
  IconFiles,
  IconHierarchy,
  IconLayoutSidebarRight,
  IconStarOff,
} from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { useState, type ReactNode } from "react"
import { isWhiteboard, type Page } from "@seqno/domain"
import { assetPageName } from "@seqno/syntax"
import { boardTitle } from "@seqno/whiteboard"
import { allPages, favorites, leftSidebarOpen, rightSidebar, toggleFavorite } from "../../atoms.ts"
import { pageNames, type PageName } from "../pages/atoms.ts"
import { GraphSwitcher } from "./GraphSwitcher.tsx"
import { Keys } from "./Keys.tsx"
import { keysOf } from "./shortcuts.ts"
import { Menu, MenuItem, usePopover } from "./popover.tsx"
import { Resizer } from "./Resizer.tsx"
import { useWhiteboardWelcome } from "./WhiteboardTour.tsx"
import {
  collapsedGroups,
  leftSidebarBounds,
  leftSidebarWidth,
  leftWidthAt,
  recentPages,
  type SidebarGroup,
} from "./state.ts"

const Group = ({
  title,
  group,
  children,
}: {
  readonly title: string
  readonly group: SidebarGroup | null
  readonly children: ReactNode
}) => {
  const [collapsed, setCollapsed] = useAtom(collapsedGroups)
  const expanded = group === null || !collapsed.includes(group)
  const toggle =
    group === null
      ? undefined
      : () =>
          setCollapsed(
            expanded ? [...collapsed, group] : collapsed.filter((other) => other !== group),
          )
  return (
    <section
      {...logseq("sidebar-group", { group, expanded })}
      aria-label={title}
      data-group={group ?? "navigations"}
    >
      {toggle === undefined ? (
        <h2 {...logseq("sidebar-group-header", false)}>
          <span className="sidebar-group-title">{title}</span>
        </h2>
      ) : (
        <h2 {...logseq("sidebar-group-header", true)}>
          <button
            type="button"
            className="sidebar-group-toggle"
            aria-expanded={expanded}
            onClick={toggle}
          >
            <span className="sidebar-group-title">{title}</span>
            <IconChevronRight className="sidebar-group-chevron" size={15} aria-hidden />
          </button>
        </h2>
      )}
      {expanded ? (
        group === null ? (
          children
        ) : (
          <div {...logseq("seqno-sidebar-group-body")}>{children}</div>
        )
      ) : null}
    </section>
  )
}

const NavItem = ({
  to,
  icon,
  label,
  keys,
  tour,
  onClick,
}: {
  readonly to: "/" | "/whiteboards" | "/all-pages" | "/graph"
  readonly icon: ReactNode
  readonly label: string
  readonly keys?: ReadonlyArray<string>
  readonly tour?: string
  readonly onClick?: () => void
}) => (
  <Link
    to={to}
    {...logseq("nav-item")}
    data-tour={tour}
    onClick={onClick}
    activeOptions={{ exact: true }}
    activeProps={logseq("seqno-nav-active")}
  >
    {icon}
    <span className="nav-item-label">{label}</span>
    {keys === undefined ? null : (
      <span className="nav-item-keys" aria-hidden>
        <Keys keys={keys} />
      </span>
    )}
  </Link>
)

const PageLink = ({
  page,
  kind,
  onUnfavorite,
}: {
  readonly page: PageName
  readonly kind: "favorite" | "recent"
  readonly onUnfavorite?: () => void
}) => {
  const updateSidebar = useAtomSet(rightSidebar)
  const board = useAtomValue(allPages).find(
    (candidate) => candidate.name === page.name && isWhiteboard(candidate),
  )
  const menu = usePopover({ placement: { align: "center", gap: 4, inset: 8 }, kind: "menu" })
  const openInSidebar = () =>
    updateSidebar({ _tag: "Open", item: { _tag: "Page", name: page.name } })
  return (
    <li {...logseq("page-link", { kind, name: page.name })}>
      <Link
        to="/page/$name"
        params={{ name: page.name }}
        className="page-link-anchor"
        onClick={(event) => {
          if (!event.shiftKey) return
          event.preventDefault()
          openInSidebar()
        }}
      >
        {board === undefined ? (
          <IconFile className={logseq("page-link-icon").className} size={16} aria-hidden />
        ) : (
          <IconChalkboard className={logseq("page-link-icon").className} size={16} aria-hidden />
        )}
        <span {...logseq("page-link-title")}>
          {board === undefined ? assetPageName(page.title) : boardTitle(board)}
        </span>
      </Link>
      <button
        type="button"
        className="page-link-actions"
        aria-label={`Actions for ${page.title}`}
        {...menu.trigger}
      >
        <IconDots size={14} aria-hidden />
      </button>
      <Menu handle={menu} label={page.title} className="page-link-menu">
        {onUnfavorite === undefined ? null : (
          <MenuItem
            icon={<IconStarOff className="page-link-menu-icon" size={18} aria-hidden />}
            onSelect={onUnfavorite}
          >
            Unfavorite
          </MenuItem>
        )}
        <MenuItem
          icon={<IconLayoutSidebarRight className="page-link-menu-icon" size={18} aria-hidden />}
          hint={<Keys keys={["shift", "Click"]} />}
          onSelect={openInSidebar}
        >
          Open in sidebar
        </MenuItem>
      </Menu>
    </li>
  )
}

const Favorites = () => {
  const starred = useAtomValue(favorites)
  const toggle = useAtomSet(toggleFavorite)
  const unfavorite = (page: Page) => () => toggle(page.name)
  return (
    <Group title="Favorites" group="favorites">
      {starred.length === 0 ? null : (
        <ul className="page-links">
          {starred.map((page) => (
            <PageLink key={page.id} page={page} kind="favorite" onUnfavorite={unfavorite(page)} />
          ))}
        </ul>
      )}
    </Group>
  )
}

const Recent = ({ graph }: { readonly graph: string }) => {
  const names = useAtomValue(recentPages)[graph] ?? []
  const everyPage = useAtomValue(pageNames)
  const byName = new Map(everyPage.map((page) => [page.name, page]))
  const visited = names.flatMap((name) => {
    const page = byName.get(name)
    return page === undefined ? [] : [page]
  })
  return (
    <Group title="Recent" group="recent">
      {visited.length === 0 ? null : (
        <ul className="page-links">
          {visited.map((page) => (
            <PageLink key={page.name} page={page} kind="recent" />
          ))}
        </ul>
      )}
    </Group>
  )
}

export const LeftSidebar = ({ graph }: { readonly graph: string }) => {
  const open = useAtomValue(leftSidebarOpen)
  const [width, setWidth] = useAtom(leftSidebarWidth)
  const welcome = useWhiteboardWelcome(graph)
  const [scrolled, setScrolled] = useState(false)
  return (
    <aside
      {...logseq("left-sidebar", open)}
      aria-label="Left sidebar"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
    >
      <div {...logseq("left-sidebar-inner")}>
        <div {...logseq("left-sidebar-wrap")}>
          <div className="left-sidebar-header">
            <GraphSwitcher graph={graph} />
            <Group title="Navigations" group={null}>
              <nav className="sidebar-nav" aria-label="Navigations">
                <NavItem
                  to="/"
                  icon={<IconCalendar className="nav-item-icon" size={16} aria-hidden />}
                  label="Journals"
                  keys={keysOf("GoJournals")}
                />
                <NavItem
                  to="/whiteboards"
                  icon={<IconChalkboard className="nav-item-icon" size={16} aria-hidden />}
                  label="Whiteboards"
                  keys={keysOf("GoWhiteboards")}
                  tour="whiteboard-home"
                  onClick={welcome}
                />
                <NavItem
                  to="/all-pages"
                  icon={<IconFiles className="nav-item-icon" size={16} aria-hidden />}
                  label="Pages"
                />
                <NavItem
                  to="/graph"
                  icon={<IconHierarchy className="nav-item-icon" size={16} aria-hidden />}
                  label="Graph view"
                  keys={keysOf("GoGraphView")}
                />
              </nav>
            </Group>
          </div>
          <div
            {...logseq("left-sidebar-contents", scrolled)}
            onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
          >
            <Favorites />
            <Recent graph={graph} />
          </div>
        </div>
        <Resizer
          className={logseq("left-sidebar-resizer").className}
          label="Resize the left sidebar"
          value={width}
          min={leftSidebarBounds.min}
          max={leftSidebarBounds.max}
          onStart={() => {
            const app = document.querySelector<HTMLElement>(".app")
            app?.setAttribute("data-resizing", "")
            const latest = { width }
            return {
              onMove: (pointerX) => {
                latest.width = leftWidthAt(pointerX)
                app?.style.setProperty("--left-sidebar-width", `${latest.width}px`)
              },
              onEnd: () => {
                app?.removeAttribute("data-resizing")
                setWidth(latest.width)
              },
            }
          }}
        />
      </div>
    </aside>
  )
}
