import { logseq } from "@seqno/dom"
import { RegistryContext, useAtom, useAtomValue } from "@effect/atom-react"
import {
  IconAdjustments,
  IconApps,
  IconDownload,
  IconPin,
  IconPinned,
  IconPuzzle,
} from "@tabler/icons-react"
import type { AtomRegistry } from "effect/reactivity"
import {
  hostAtom,
  installedPlugins,
  pinnedToolbarItems,
  PluginItem,
  pluginSettings,
  running,
  settingsFor,
  uiItems,
  updatesChecking,
  updatesComing,
  type Host,
  type UIItem,
} from "@seqno/plugins"
import { useContext, type KeyboardEvent, type MouseEvent } from "react"
import { leftSidebarOpen } from "../../atoms.ts"
import { IconButton } from "../shell/IconButton.tsx"
import { Menu, MenuItem, MenuSeparator, usePopover } from "../shell/popover.tsx"
import { AutoCheckUpdates, openPluginUpdates } from "./PluginUpdates.tsx"
import { openPlugins } from "./PluginsDialog.tsx"

const pinKey = (item: UIItem) => `${item.pid}:${item.key}`

const Entry = ({
  host,
  item,
  pinned,
  onToggle,
}: {
  readonly host: Host
  readonly item: UIItem
  readonly pinned: boolean
  readonly onToggle: () => void
}) => (
  <div
    role="menuitemcheckbox"
    aria-checked={pinned}
    aria-label={item.key}
    tabIndex={-1}
    {...logseq("menu-item")}
    onClick={(event: MouseEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest("[data-injected-ui]") !== null)
        return
      onToggle()
    }}
    onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      onToggle()
    }}
  >
    <div {...logseq("plugin-toolbar-entry")}>
      <PluginItem host={host} item={item} inMenu />
      <span className="plugin-toolbar-key">{item.key}</span>
      <span {...logseq("plugin-toolbar-pin", pinned)}>
        {pinned ? <IconPinned size={16} aria-hidden /> : <IconPin size={16} aria-hidden />}
      </span>
    </div>
  </div>
)

const widthOf = (element: Element | null | undefined) =>
  element instanceof HTMLElement ? element.offsetWidth : 0

// Logseq's cap on the toolbar row: https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1080-L1106
const capWidth = (registry: AtomRegistry.AtomRegistry) => (list: HTMLDivElement) => {
  const header = list.closest("header")
  const left = header?.querySelector(":scope > .head-left")
  const right = header?.querySelector(":scope > .head-right")
  const main = document.querySelector(".main-content-container")
  if (header === null || right === null || right === undefined || main === null) return
  const cap = () => {
    const others = [...right.children]
      .filter((child) => !child.contains(list) && !child.matches("[popover]"))
      .reduce((sum, child) => sum + widthOf(child), 0)
    const room = widthOf(main) - (registry.get(leftSidebarOpen) ? 0 : widthOf(left))
    list.style.maxWidth = `${Math.max(room - others - 100, 76)}px`
  }
  const observer = new ResizeObserver(cap)
  for (const watched of [main, left, right])
    if (watched instanceof Element) observer.observe(watched)
  return () => observer.disconnect()
}

export const ToolbarPlugins = () => {
  const registry = useContext(RegistryContext)
  const host = useAtomValue(hostAtom)
  const items = useAtomValue(uiItems)
    .filter((item) => item.type === "toolbar")
    .toSorted((left, right) => left.key.localeCompare(right.key))
  const [pinned, setPinned] = useAtom(pinnedToolbarItems)
  const checking = useAtomValue(updatesChecking)
  const coming = useAtomValue(updatesComing)
  const found = checking?.auto !== true && coming.length > 0
  const menu = usePopover({ placement: { align: "end", gap: 4, inset: 0 }, kind: "menu" })
  if (host === null || items.length === 0) return null
  const isPinned = (item: UIItem) => pinned?.includes(pinKey(item)) ?? false
  const toggle = (item: UIItem) => {
    const current = pinned ?? []
    setPinned(
      isPinned(item) ? current.filter((key) => key !== pinKey(item)) : [...current, pinKey(item)],
    )
  }
  const openFirstSettings = () => {
    const states = registry.get(running)
    const first = registry
      .get(installedPlugins)
      .find(
        (plugin) =>
          registry.get(pluginSettings(plugin.id))["disabled"] !== true &&
          (states[plugin.id]?.schema.length ?? 0) > 0,
      )
    if (first !== undefined) registry.set(settingsFor, first.id)
  }
  return (
    <div {...logseq("plugin-toolbar")} data-type="toolbar">
      <div {...logseq("plugin-toolbar-list")} ref={capWidth(registry)}>
        {(pinned === null ? items : items.filter(isPinned)).map((item) => (
          <PluginItem key={pinKey(item)} host={host} item={item} />
        ))}
      </div>
      <div {...logseq("plugin-toolbar-trigger")}>
        <div {...logseq("plugin-toolbar-manager")}>
          <IconButton
            label="Plugin toolbar items"
            {...logseq("plugin-toolbar-button")}
            icon={
              <>
                <IconPuzzle size={20} aria-hidden />
                {found ? <span {...logseq("plugin-updates-point")} data-place="button" /> : null}
              </>
            }
            {...menu.trigger}
          />
        </div>
        <Menu handle={menu} label="Plugin toolbar items" className="plugin-toolbar-menu">
          {menu.open ? (
            <>
              {items.map((item) => (
                <Entry
                  key={pinKey(item)}
                  host={host}
                  item={item}
                  pinned={isPinned(item)}
                  onToggle={() => toggle(item)}
                />
              ))}
              <MenuSeparator />
              <MenuItem icon={<IconApps size={18} aria-hidden />} onSelect={openPlugins}>
                Plugins
              </MenuItem>
              <MenuItem
                icon={<IconAdjustments size={18} aria-hidden />}
                onSelect={openFirstSettings}
              >
                Settings
              </MenuItem>
              {found ? (
                <MenuItem
                  icon={<IconDownload size={18} aria-hidden />}
                  onSelect={() => openPluginUpdates(registry)}
                >
                  New updates
                  <span {...logseq("plugin-updates-point")} data-place="menu" />
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <AutoCheckUpdates />
            </>
          ) : null}
        </Menu>
      </div>
    </div>
  )
}
