import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconCalendar,
  IconChevronRight,
  IconDots,
  IconFile,
  IconFiles,
  IconLayoutSidebarRight,
  IconStarOff,
} from "@tabler/icons-react"
import { Link, useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Page } from "@seqno/domain"
import { allPages, dispatch, favorites, leftSidebarOpen, rightSidebar } from "../../atoms.ts"
import { GraphSwitcher } from "./GraphSwitcher.tsx"
import { Keys } from "./Keys.tsx"
import { keysOf } from "./shortcuts.ts"
import { Menu, MenuItem, openMenuAt, usePopover } from "./popover.tsx"
import { Resizer } from "./Resizer.tsx"
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
    <section className="sidebar-group" data-group={group ?? "navigations"}>
      {toggle === undefined ? (
        <h2 className="sidebar-group-header">
          <span className="sidebar-group-title">{title}</span>
        </h2>
      ) : (
        <h2 className="sidebar-group-header">
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
      {expanded ? children : null}
    </section>
  )
}

const NavItem = ({
  to,
  icon,
  label,
  keys,
}: {
  readonly to: "/" | "/all-pages"
  readonly icon: ReactNode
  readonly label: string
  readonly keys?: ReadonlyArray<string>
}) => (
  <Link to={to} className="nav-item" activeOptions={{ exact: true }}>
    {icon}
    <span className="nav-item-label">{label}</span>
    {keys === undefined ? null : (
      <span className="nav-item-keys" aria-hidden>
        <Keys keys={keys} />
      </span>
    )}
  </Link>
)

const PageLink = ({ page, starred }: { readonly page: Page; readonly starred: boolean }) => {
  const updateSidebar = useAtomSet(rightSidebar)
  const run = useAtomSet(dispatch)
  const menu = usePopover({ placement: { align: "start", gap: 4, inset: 8 }, kind: "menu" })
  const openInSidebar = () =>
    updateSidebar({ _tag: "Open", item: { _tag: "Page", name: page.name } })
  return (
    <li className="page-link">
      <Link
        to="/page/$name"
        params={{ name: page.name }}
        className="page-link-anchor"
        onClick={(event) => {
          if (!event.shiftKey) return
          event.preventDefault()
          openInSidebar()
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          openMenuAt(menu.id, event.clientX, event.clientY)
        }}
      >
        <IconFile className="page-link-icon" size={16} aria-hidden />
        <span className="page-link-title">{page.title}</span>
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
        {starred ? (
          <MenuItem
            icon={<IconStarOff size={18} aria-hidden />}
            onSelect={() =>
              run({
                _tag: "SetProperty",
                target: { _tag: "PageTarget", pageId: page.id },
                key: "favorite",
                value: null,
              })
            }
          >
            Unfavorite
          </MenuItem>
        ) : null}
        <MenuItem
          icon={<IconLayoutSidebarRight size={18} aria-hidden />}
          hint="⇧ Click"
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
  return (
    <Group title="Favorites" group="favorites">
      {starred.length === 0 ? null : (
        <ul className="page-links">
          {starred.map((page) => (
            <PageLink key={page.id} page={page} starred />
          ))}
        </ul>
      )}
    </Group>
  )
}

const Recent = ({ graph }: { readonly graph: string }) => {
  const names = useAtomValue(recentPages)[graph] ?? []
  const everyPage = useAtomValue(allPages)
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
            <PageLink key={page.id} page={page} starred={false} />
          ))}
        </ul>
      )}
    </Group>
  )
}

export const LeftSidebar = ({ graph }: { readonly graph: string }) => {
  const open = useAtomValue(leftSidebarOpen)
  const [width, setWidth] = useAtom(leftSidebarWidth)
  const navigate = useNavigate()
  return (
    <aside
      className="left-sidebar"
      aria-label="Left sidebar"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="left-sidebar-inner">
        <div className="left-sidebar-wrap">
          <div className="left-sidebar-header">
            <GraphSwitcher graph={graph} onSwitch={() => void navigate({ to: "/" })} />
            <Group title="Navigations" group={null}>
              <nav className="sidebar-nav" aria-label="Navigations">
                <NavItem
                  to="/"
                  icon={<IconCalendar className="nav-item-icon" size={16} aria-hidden />}
                  label="Journals"
                  keys={keysOf("GoJournals")}
                />
                <NavItem
                  to="/all-pages"
                  icon={<IconFiles className="nav-item-icon" size={16} aria-hidden />}
                  label="Pages"
                />
              </nav>
            </Group>
          </div>
          <div className="left-sidebar-contents">
            <Favorites />
            <Recent graph={graph} />
          </div>
        </div>
        <Resizer
          className="left-sidebar-resizer"
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
