import { logseq } from "@seqno/dom"
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconAlertTriangle,
  IconColorSwatch,
  IconFileExport,
  IconDots,
  IconHome,
  IconLayoutSidebarRight,
  IconMenu2,
  IconSearch,
  IconPuzzle,
  IconSettings,
} from "@tabler/icons-react"
import { useMatchRoute, useNavigate } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Page } from "@seqno/domain"
import { SaveState } from "@seqno/rpc"
import {
  journals,
  leftSidebarOpen,
  pageNamed,
  rightSidebar,
  saveState,
  searchOpen,
} from "../../atoms.ts"
import { Appearance } from "./Appearance.tsx"
import { openPlugins } from "../plugins/PluginsDialog.tsx"
import { ToolbarPlugins } from "../plugins/ToolbarPlugins.tsx"
import { openGraphExport } from "./Export.tsx"
import { IconButton } from "./IconButton.tsx"
import { PageMenuItems } from "./PageMenu.tsx"
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
import { Keys } from "./Keys.tsx"
import { documentMode, settingsDialogId, settingsTab } from "./state.ts"

const useCurrentPage = (): Page | undefined => {
  const matchRoute = useMatchRoute()
  const onPage = matchRoute({ to: "/page/$name" })
  const named = useAtomValue(pageNamed(onPage === false ? "" : onPage.name))
  const days = useAtomValue(journals)
  if (matchRoute({ to: "/" }) !== false) return days[0]
  if (onPage === false) return undefined
  return Option.getOrUndefined(AsyncResult.getOrElse(named, () => Option.none()))
}

const MoreMenu = () => {
  const page = useCurrentPage()
  const more = usePopover({ placement: { align: "start", gap: -2, inset: 11 }, kind: "menu" })
  const appearance = usePopover({
    placement: { align: "end", gap: 4, inset: 0 },
    kind: "dialog",
    anchorOverride: more.anchor,
  })
  const setSettingsTab = useAtomSet(settingsTab)
  return (
    <>
      <IconButton
        label="More"
        {...logseq("seqno-more-button")}
        icon={<IconDots size={20} aria-hidden />}
        {...more.trigger}
      />
      <Menu handle={more} label="More" className="more-menu">
        {page === undefined ? null : (
          <>
            <PageMenuItems page={page} />
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
        <MenuItem icon={<IconPuzzle size={18} aria-hidden />} onSelect={openPlugins}>
          Plugins
        </MenuItem>
        <MenuItem
          icon={<IconColorSwatch size={18} aria-hidden />}
          onSelect={() => showPopover(appearance.id)}
        >
          Appearance
        </MenuItem>
        <MenuItem icon={<IconFileExport size={18} aria-hidden />} onSelect={openGraphExport}>
          Export graph
        </MenuItem>
      </Menu>
      <Appearance handle={appearance} />
    </>
  )
}

const DocumentModeButton = () => {
  const [on, setOn] = useAtom(documentMode)
  const hint = useTooltip({
    label: "Document mode",
    body: (
      <ul className="seqno-doc-mode-hint">
        <li>
          <Keys keys={["shift", "enter"]} framed /> to create new block
        </li>
        <li>
          Click `D` or type <Keys keys={keysOf("ToggleDocumentMode")} framed /> to toggle document
          mode
        </li>
      </ul>
    ),
  })
  if (!on) return null
  return (
    <>
      <button
        type="button"
        className="seqno-doc-mode"
        aria-label="Turn off document mode"
        {...hint.props}
        onClick={() => setOn(false)}
      >
        D
      </button>
      {hint.tooltip}
    </>
  )
}

const NotSaved = ({ reason }: { readonly reason: string }) => {
  const hint = useTooltip({ label: `Not saved: ${reason}` })
  return (
    <>
      <span
        className="save-state is-failed"
        data-save-state="failed"
        role="alert"
        tabIndex={0}
        {...hint.props}
      >
        <IconAlertTriangle size={16} stroke={2} aria-hidden />
        Not saved
      </span>
      {hint.tooltip}
    </>
  )
}

const SaveStatus = () =>
  SaveState.match(
    AsyncResult.getOrElse(useAtomValue(saveState), (): SaveState => SaveState.cases.Saved.make({})),
    {
      Saved: () => <span className="save-state" data-save-state="saved" />,
      Unsaved: () => (
        <span
          className="save-state is-unsaved"
          data-save-state="unsaved"
          role="status"
          aria-label="Saving"
        />
      ),
      Failed: ({ reason }) => <NotSaved reason={reason} />,
    },
  )

const SearchButton = () => {
  const setSearchOpen = useAtomSet(searchOpen)
  return (
    <IconButton
      label="Search"
      {...logseq("seqno-search-button")}
      data-hint-anchor="search"
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
    <header {...logseq("head")}>
      <div {...logseq("head-left")}>
        <IconButton
          label="Toggle left sidebar"
          {...logseq("seqno-left-menu")}
          data-hint-anchor="left-sidebar"
          tooltip={{ label: "Toggle left sidebar", keys: keysOf("ToggleLeftSidebar") }}
          icon={<IconMenu2 size={20} aria-hidden />}
          aria-expanded={leftOpen}
          onClick={() => setLeftOpen(!leftOpen)}
        />
        <SearchButton />
      </div>
      <div {...logseq("head-right")}>
        <ToolbarPlugins />
        <SaveStatus />
        {home ? null : (
          <IconButton
            label="Home"
            {...logseq("seqno-home-button")}
            tooltip={{ label: "Home", keys: keysOf("GoHome") }}
            icon={<IconHome size={20} aria-hidden />}
            onClick={() => void navigate({ to: "/" })}
          />
        )}
        <DocumentModeButton />
        <MoreMenu />
        <IconButton
          label="Toggle right sidebar"
          {...logseq("seqno-right-toggle")}
          tooltip={{ label: "Toggle right sidebar", keys: keysOf("ToggleRightSidebar") }}
          icon={<IconLayoutSidebarRight size={20} aria-hidden />}
          onClick={() => updateSidebar({ _tag: "Toggle" })}
        />
      </div>
    </header>
  )
}
