import { logseq } from "@seqno/dom"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { IconAdjustmentsHorizontal, IconHistory, IconKeyboard, IconX } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useId } from "react"
import type { ReactNode } from "react"
import type { AppFilePath } from "@seqno/rpc"
import { openGraph, resolvedTheme } from "../../atoms.ts"
import { revision } from "../../version.ts"
import { SettingSwitch, ThemeChoices, themeLabelOf } from "./Appearance.tsx"
import { AccentColorList } from "./AccentColors.tsx"
import { Keys } from "./Keys.tsx"
import { VersionControl } from "./Git.tsx"
import { closeDialogOf, Dialog } from "./popover.tsx"
import { ShortcutList } from "./ShortcutList.tsx"
import { keysOf } from "./shortcuts.ts"
import { settingsDialogId, settingsTab, vimMode, wideMode } from "./state.ts"
import type { SettingsTab } from "./state.ts"

const tabs: ReadonlyArray<readonly [SettingsTab, string, ReactNode]> = [
  ["general", "General", <IconAdjustmentsHorizontal key="general" size={16} aria-hidden />],
  ["keymap", "Keymap", <IconKeyboard key="keymap" size={16} aria-hidden />],
  ["version-control", "Version control", <IconHistory key="git" size={16} aria-hidden />],
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

const appFileRows: ReadonlyArray<readonly [string, AppFilePath]> = [
  ["Custom configuration", "logseq/config.edn"],
  ["Custom theme", "logseq/custom.css"],
  ["Export theme", "logseq/export.css"],
]

const EditFile = ({ label, path }: { readonly label: string; readonly path: AppFilePath }) => {
  const labelId = useId()

  return (
    <Row label={label} labelId={labelId}>
      <Link
        to="/file/$path"
        params={{ path }}
        className="button-secondary settings-link"
        aria-describedby={labelId}
        onClick={(event) => closeDialogOf(event.currentTarget)}
      >
        Edit {path.slice(path.indexOf("/") + 1)}
      </Link>
    </Row>
  )
}

const General = () => {
  const graphOpen = Option.isSome(AsyncResult.value(useAtomValue(openGraph)))
  const resolved = useAtomValue(resolvedTheme)
  const versionLabel = useId()
  const themeLabel = useId()
  const wideLabel = useId()
  const vimLabel = useId()
  const accentLabel = useId()

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
      <Row label="Accent color" labelId={accentLabel}>
        <AccentColorList />
        <Keys keys={keysOf("PickAccentColor")} />
      </Row>
      {graphOpen
        ? appFileRows.map(([label, path]) => <EditFile key={path} label={label} path={path} />)
        : null}
      <Row label="Wide mode" labelId={wideLabel}>
        <SettingSwitch setting={wideMode} labelledBy={wideLabel} />
        <Keys keys={keysOf("ToggleWideMode")} />
      </Row>
      <Row label="Vim mode" labelId={vimLabel}>
        <SettingSwitch setting={vimMode} labelledBy={vimLabel} />
      </Row>
    </>
  )
}

export const Settings = () => {
  const [tab, setTab] = useAtom(settingsTab)
  const title = tabs.find(([id]) => id === tab)?.[1] ?? "General"

  return (
    <Dialog
      id={settingsDialogId}
      label="Settings"
      className={logseq("settings").className}
      focusSelf
    >
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
              onClick={() => {
                setTab(id)
              }}
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
        {tab === "general" ? <General /> : tab === "keymap" ? <ShortcutList /> : <VersionControl />}
      </div>
    </Dialog>
  )
}
