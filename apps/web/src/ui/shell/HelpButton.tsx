import { IconCommand, IconHelpSmall, IconX } from "@tabler/icons-react"
import { useId } from "react"
import { Keys } from "./Keys.tsx"
import { helpMenuId, shortcutsDialogId } from "./listeners.ts"
import {
  closeDialogOf,
  Dialog,
  MenuItem,
  onMenuKeyDown,
  openDialog,
  usePopover,
  useTooltip,
} from "./popover.tsx"
import { keysOf, type ShortcutAction } from "./shortcuts.ts"

const groups: ReadonlyArray<
  readonly [string, ReadonlyArray<readonly [string, ShortcutAction | ReadonlyArray<string>]>]
> = [
  [
    "Navigation",
    [
      ["Search pages and blocks", ["mod", "k"]],
      ["Go to journals", "GoJournals"],
      ["Go to home", "GoHome"],
      ["Go to all pages", "GoAllPages"],
      ["Go to keyboard shortcuts", "GoShortcuts"],
    ],
  ],
  [
    "Sidebars",
    [
      ["Toggle left sidebar", "ToggleLeftSidebar"],
      ["Toggle right sidebar", "ToggleRightSidebar"],
      ["Toggle Contents in sidebar", "ToggleContents"],
      ["Open today's page in the right sidebar", "OpenTodayInSidebar"],
      ["Closes the top item in the right sidebar", "CloseTopSidebarItem"],
    ],
  ],
  [
    "Appearance",
    [
      ["Toggle between dark/light theme", "ToggleTheme"],
      ["Toggle wide mode", "ToggleWideMode"],
      ["Toggle help", "ToggleHelp"],
    ],
  ],
]

const keysFor = (binding: ShortcutAction | ReadonlyArray<string>) =>
  typeof binding === "string" ? keysOf(binding) : binding

export const ShortcutGroups = () =>
  groups.map(([group, rows]) => (
    <section key={group} className="shortcuts-group" aria-label={group}>
      <h3 className="shortcuts-group-title">{group}</h3>
      <dl className="shortcuts-list">
        {rows.map(([label, binding]) => (
          <div key={label} className="shortcuts-row">
            <dt>{label}</dt>
            <dd>
              <Keys keys={keysFor(binding)} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  ))

const Shortcuts = () => {
  const title = useId()
  return (
    <Dialog id={shortcutsDialogId} label="Keyboard shortcuts" className="shortcuts">
      <div className="shortcuts-header">
        <h2 id={title} className="shortcuts-title">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          aria-label="Close"
          className="icon-button shortcuts-close"
          onClick={(event) => closeDialogOf(event.currentTarget)}
        >
          <IconX size={18} aria-hidden />
        </button>
      </div>
      <div className="shortcuts-body">
        <ShortcutGroups />
      </div>
    </Dialog>
  )
}

export const HelpButton = () => {
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
          onSelect={() => openDialog(shortcutsDialogId)}
        >
          Keyboard shortcuts
        </MenuItem>
      </div>
      <Shortcuts />
    </div>
  )
}
