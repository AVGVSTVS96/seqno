import { useAtomValue } from "@effect/atom-react"
import { IconAdjustmentsHorizontal, IconKeyboard, IconX } from "@tabler/icons-react"
import { useId, useState, type ReactNode } from "react"
import { resolvedTheme } from "../../atoms.ts"
import { ThemeChoices, themeLabelOf, WideModeSwitch } from "./Appearance.tsx"
import { ShortcutGroups } from "./HelpButton.tsx"
import { Keys } from "./Keys.tsx"
import { closeDialogOf, Dialog } from "./popover.tsx"
import { keysOf } from "./shortcuts.ts"

export const settingsDialogId = "seqno-settings"

type Tab = "general" | "keymap"

const tabs: ReadonlyArray<readonly [Tab, string, ReactNode]> = [
  ["general", "General", <IconAdjustmentsHorizontal key="general" size={16} aria-hidden />],
  ["keymap", "Keymap", <IconKeyboard key="keymap" size={16} aria-hidden />],
]

const Row = ({
  label,
  labelId,
  children,
}: {
  readonly label: string
  readonly labelId: string
  readonly children: ReactNode
}) => (
  <div className="settings-row">
    <span id={labelId} className="settings-label">
      {label}
    </span>
    <div className="settings-control">{children}</div>
  </div>
)

const General = () => {
  const resolved = useAtomValue(resolvedTheme)
  const themeLabel = useId()
  const wideLabel = useId()
  return (
    <>
      <Row label={themeLabelOf(resolved)} labelId={themeLabel}>
        <ThemeChoices labelledBy={themeLabel} />
        <Keys keys={keysOf("ToggleTheme")} />
      </Row>
      <Row label="Wide mode" labelId={wideLabel}>
        <WideModeSwitch labelledBy={wideLabel} />
        <Keys keys={keysOf("ToggleWideMode")} />
      </Row>
    </>
  )
}

export const Settings = () => {
  const [tab, setTab] = useState<Tab>("general")
  const title = tabs.find(([id]) => id === tab)?.[1] ?? "General"
  return (
    <Dialog id={settingsDialogId} label="Settings" className="settings">
      <div className="settings-nav">
        <h1 className="settings-title">Settings</h1>
        <div role="tablist" aria-orientation="vertical" className="settings-tabs">
          {tabs.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="settings-tab"
              onClick={() => setTab(id)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-panel" role="tabpanel" aria-label={title} tabIndex={-1} autoFocus>
        <button
          type="button"
          aria-label="Close"
          className="icon-button settings-close"
          onClick={(event) => closeDialogOf(event.currentTarget)}
        >
          <IconX size={18} aria-hidden />
        </button>
        <h2 className="settings-panel-title">{title}</h2>
        {tab === "general" ? (
          <General />
        ) : (
          <div className="settings-keymap">
            <ShortcutGroups />
          </div>
        )}
      </div>
    </Dialog>
  )
}
