import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconBook, IconBulb, IconCommand, IconHelpSmall, IconInfoCircle } from "@tabler/icons-react"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { openGraph, rightSidebar } from "../../atoms.ts"
import { isDemoGraph } from "../../graph-locations.ts"
import { homepage, revision } from "../../version.ts"
import { helpItem, helpMenuId } from "./listeners.ts"
import { MenuItem, MenuSeparator, onMenuKeyDown, usePopover, useTooltip } from "./popover.tsx"
import { dismissedHints } from "./state.ts"

const logseqDocs = "https://docs.logseq.com"

export const HelpButton = () => {
  const updateSidebar = useAtomSet(rightSidebar)
  const showTips = useAtomSet(dismissedHints)
  const inDemo = Option.exists(AsyncResult.value(useAtomValue(openGraph)), (opened) =>
    isDemoGraph(opened.graph),
  )
  const menu = usePopover({
    id: helpMenuId,
    placement: { align: "end", gap: 8, inset: 8, side: "top" },
    kind: "menu",
  })
  const hint = useTooltip(
    { label: "View shortcuts and tips" },
    { align: "end", gap: 8, inset: 4, side: "top" },
  )
  return (
    <div className="help">
      <button
        type="button"
        aria-label="Help"
        className="help-button"
        {...menu.trigger}
        {...(menu.open ? {} : hint.props)}
      >
        <IconHelpSmall size={24} aria-hidden />
      </button>
      {menu.open ? null : hint.tooltip}
      <div
        id={menu.id}
        popover="auto"
        role="menu"
        aria-label="Help"
        tabIndex={-1}
        className="help-menu"
        onBeforeToggle={menu.onBeforeToggle}
        onToggle={menu.onToggle}
        onKeyDown={onMenuKeyDown}
      >
        <MenuItem
          icon={<IconCommand size={20} aria-hidden />}
          onSelect={() => updateSidebar({ _tag: "Open", item: helpItem })}
        >
          Keyboard shortcuts
        </MenuItem>
        <MenuItem
          icon={<IconBook size={20} aria-hidden />}
          onSelect={() => void window.open(logseqDocs, "_blank", "noopener")}
        >
          Logseq documentation
        </MenuItem>
        {inDemo ? (
          <MenuItem icon={<IconBulb size={20} aria-hidden />} onSelect={() => showTips([])}>
            Show tips again
          </MenuItem>
        ) : null}
        <MenuItem
          icon={<IconInfoCircle size={20} aria-hidden />}
          onSelect={() => window.location.assign(homepage)}
        >
          About seqno
        </MenuItem>
        <MenuSeparator />
        <div className="help-menu-footer">
          <span>seqno</span>
          <span>Revision {revision}</span>
        </div>
      </div>
    </div>
  )
}
