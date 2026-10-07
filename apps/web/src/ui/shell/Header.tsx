import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconColorSwatch,
  IconDots,
  IconHome,
  IconLayoutSidebarRight,
  IconMenu2,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react"
import { useMatchRoute, useNavigate } from "@tanstack/react-router"
import { Effect, Option } from "effect"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { useContext } from "react"
import type { Page } from "@seqno/domain"
import { pageTreeAtom } from "@seqno/outliner"
import {
  favorites,
  journals,
  leftSidebarOpen,
  pageNamed,
  rightSidebar,
  searchOpen,
  toggleFavorite,
} from "../../atoms.ts"
import { Appearance } from "./Appearance.tsx"
import { DeletePage } from "./DeletePage.tsx"
import { exported, pageMarkdown } from "./Export.tsx"
import { IconButton } from "./IconButton.tsx"
import { Menu, MenuItem, MenuSeparator, openDialog, showPopover, usePopover } from "./popover.tsx"
import { keysOf } from "./shortcuts.ts"
import { settingsDialogId, settingsTab } from "./state.ts"

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
  const registry = useContext(RegistryContext)
  const setExported = useAtomSet(exported)
  const exportPage = (target: Page) =>
    void Effect.runPromise(
      AtomRegistry.getResult(registry, pageTreeAtom(target.id)).pipe(
        Effect.map((tree) =>
          setExported({ name: target.title, text: pageMarkdown(target.props, tree.blocks) }),
        ),
        Effect.ignore,
      ),
    )
  const navigate = useNavigate()
  const more = usePopover({ placement: { align: "start", gap: -2, inset: 11 }, kind: "menu" })
  const appearance = usePopover({
    placement: { align: "end", gap: 4, inset: 0 },
    kind: "dialog",
    anchorOverride: more.anchor,
  })
  const toggle = useAtomSet(toggleFavorite)
  const setSettingsTab = useAtomSet(settingsTab)
  const starred = useAtomValue(favorites).some((favorite) => favorite.id === page?.id)
  return (
    <>
      <IconButton label="More" icon={<IconDots size={20} aria-hidden />} {...more.trigger} />
      <Menu handle={more} label="More" className="more-menu">
        {page === undefined ? null : (
          <>
            <MenuItem onSelect={() => toggle(page.name)}>
              {starred ? "Unfavorite" : "Add to Favorites"}
            </MenuItem>
            {page.journalDay === null ? (
              <MenuItem onSelect={() => openDialog(deleteDialog)}>Delete page</MenuItem>
            ) : null}
            <MenuItem onSelect={() => exportPage(page)}>Export page</MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem
          icon={<IconSettings size={18} aria-hidden />}
          onSelect={() => {
            setSettingsTab("general")
            openDialog(settingsDialogId)
          }}
        >
          Settings
        </MenuItem>
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
  return (
    <IconButton
      label="Search"
      tooltip={{ label: "Search", keys: ["mod", "k"] }}
      icon={<IconSearch size={20} aria-hidden />}
      onClick={() => setSearchOpen(true)}
    />
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
