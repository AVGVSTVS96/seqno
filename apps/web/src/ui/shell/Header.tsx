import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconColorSwatch,
  IconDots,
  IconHome,
  IconLayoutSidebarRight,
  IconMenu2,
  IconSearch,
} from "@tabler/icons-react"
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Page } from "@seqno/domain"
import {
  dispatch,
  journals,
  leftSidebarOpen,
  pageNamed,
  rightSidebar,
  searchOpen,
} from "../../atoms.ts"
import { Appearance } from "./Appearance.tsx"
import { DeletePage } from "./DeletePage.tsx"
import { IconButton } from "./IconButton.tsx"
import {
  Menu,
  MenuItem,
  MenuSeparator,
  openDialog,
  showPopover,
  usePopover,
  useTooltip,
} from "./popover.tsx"
import { keysOf } from "./shortcuts.ts"

const useCurrentPage = (): Page | undefined => {
  const matchRoute = useMatchRoute()
  const onPage = matchRoute({ to: "/page/$name" })
  const named = useAtomValue(pageNamed(onPage === false ? "" : onPage.name))
  const days = useAtomValue(journals)
  if (matchRoute({ to: "/" }) !== false) return days[0]
  if (onPage === false) return undefined
  return Option.getOrUndefined(AsyncResult.getOrElse(named, () => Option.none()))
}

const deleteDialog = "seqno-delete-page"

const MoreMenu = () => {
  const page = useCurrentPage()
  const run = useAtomSet(dispatch)
  const navigate = useNavigate()
  const more = usePopover({ placement: { align: "start", gap: -2, inset: 11 }, kind: "menu" })
  const appearance = usePopover({
    placement: { align: "end", gap: 4, inset: 0 },
    kind: "dialog",
    anchorOverride: more.anchor,
  })
  const starred = page?.props["favorite"] === "true"
  return (
    <>
      <IconButton label="More" icon={<IconDots size={20} aria-hidden />} {...more.trigger} />
      <Menu handle={more} label="More" className="more-menu">
        {page === undefined ? null : (
          <>
            <MenuItem
              onSelect={() =>
                run({
                  _tag: "SetProperty",
                  target: { _tag: "PageTarget", pageId: page.id },
                  key: "favorite",
                  value: starred ? null : "true",
                })
              }
            >
              {starred ? "Unfavorite" : "Add to Favorites"}
            </MenuItem>
            {page.journalDay === null ? (
              <MenuItem onSelect={() => openDialog(deleteDialog)}>Delete page</MenuItem>
            ) : null}
            <MenuSeparator />
          </>
        )}
        <MenuItem
          icon={<IconColorSwatch size={18} aria-hidden />}
          onSelect={() => showPopover(appearance.id)}
        >
          Appearance
        </MenuItem>
      </Menu>
      <Appearance handle={appearance} />
      {page === undefined || page.journalDay !== null ? null : (
        <DeletePage id={deleteDialog} page={page} onDeleted={() => void navigate({ to: "/" })} />
      )}
    </>
  )
}

const SearchButton = () => {
  const setSearchOpen = useAtomSet(searchOpen)
  const hint = useTooltip({ label: "Search", keys: ["mod", "k"] })
  return (
    <>
      <Link
        to="/search"
        search={{}}
        aria-label="Search"
        className="icon-button"
        onClick={() => setSearchOpen(true)}
        {...hint.props}
      >
        <IconSearch size={20} aria-hidden />
      </Link>
      {hint.tooltip}
    </>
  )
}

export const Header = () => {
  const [leftOpen, setLeftOpen] = useAtom(leftSidebarOpen)
  const updateSidebar = useAtomSet(rightSidebar)
  const matchRoute = useMatchRoute()
  const navigate = useNavigate()
  const home = matchRoute({ to: "/" }) !== false
  return (
    <header className="head">
      <div className="head-left">
        <IconButton
          label="Toggle left sidebar"
          tooltip={{ label: "Toggle left sidebar", keys: keysOf("ToggleLeftSidebar") }}
          icon={<IconMenu2 size={20} aria-hidden />}
          aria-expanded={leftOpen}
          onClick={() => setLeftOpen(!leftOpen)}
        />
        <SearchButton />
      </div>
      <div className="head-right">
        {home ? null : (
          <IconButton
            label="Home"
            tooltip={{ label: "Home", keys: keysOf("GoHome") }}
            icon={<IconHome size={20} aria-hidden />}
            onClick={() => void navigate({ to: "/" })}
          />
        )}
        <MoreMenu />
        <IconButton
          label="Toggle right sidebar"
          tooltip={{ label: "Toggle right sidebar", keys: keysOf("ToggleRightSidebar") }}
          icon={<IconLayoutSidebarRight size={20} aria-hidden />}
          onClick={() => updateSidebar({ _tag: "Toggle" })}
        />
      </div>
    </header>
  )
}
