import { useAtom, useAtomValue } from "@effect/atom-react"
import { IconAdjustmentsHorizontal, IconKeyboard, IconX } from "@tabler/icons-react"
import { useId, type ReactNode } from "react"
import { resolvedTheme } from "../../atoms.ts"
import { revision } from "../../version.ts"
import { ThemeChoices, themeLabelOf, WideModeSwitch } from "./Appearance.tsx"
import { Keys } from "./Keys.tsx"
import { closeDialogOf, Dialog } from "./popover.tsx"
import { ShortcutList } from "./ShortcutList.tsx"
import { keysOf } from "./shortcuts.ts"
import { settingsDialogId, settingsTab, type SettingsTab } from "./state.ts"

const tabs: ReadonlyArray<readonly [SettingsTab, string, ReactNode]> = [
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
  const versionLabel = useId()
  const themeLabel = useId()
  const wideLabel = useId()
  return (
    <>
      <Row label="Current version" labelId={versionLabel}>
        <span className="settings-version" aria-labelledby={versionLabel}>
          {revision}
        </span>
      </Row>
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
  const [tab, setTab] = useAtom(settingsTab)
  const title = tabs.find(([id]) => id === tab)?.[1] ?? "General"
  return (
    <Dialog id={settingsDialogId} label="Settings" className="settings" focusSelf>
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
      <div className="settings-panel" role="tabpanel" aria-label={title}>
        <button
          type="button"
          aria-label="Close"
          className="icon-button settings-close"
          onClick={(event) => closeDialogOf(event.currentTarget)}
        >
          <IconX size={18} aria-hidden />
        </button>
        <h2 className="settings-panel-title">{title}</h2>
        {tab === "general" ? <General /> : <ShortcutList />}
      </div>
    </Dialog>
  )
}
