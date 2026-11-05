import { logseq, names } from "@seqno/dom"
import { useAtom, useAtomValue } from "@effect/atom-react"
import type { Atom } from "effect/reactivity"
import { useId } from "react"
import type { ReactNode } from "react"
import { resolvedTheme, theme } from "../../atoms.ts"
import type { ThemeChoice } from "../../atoms.ts"
import { Keys } from "./Keys.tsx"
import type { PopoverHandle } from "./popover.tsx"
import { keysOf } from "./shortcuts.ts"
import { wideMode } from "./state.ts"

const choices: readonly ThemeChoice[] = ["light", "dark", "system"]

const Row = ({
  label,
  labelId,
  keys,
  children,
}: {
  readonly label: string
  readonly labelId: string
  readonly keys: readonly string[]
  readonly children: ReactNode
}) => (
  <div className="appearance-row">
    <span id={labelId} className="appearance-label">
      {label}
    </span>
    <div className="appearance-control">
      {children}
      <span className="appearance-keys">
        <Keys keys={keys} />
      </span>
    </div>
  </div>
)

const Preview = ({ choice }: { readonly choice: ThemeChoice }) => (
  <span className="theme-preview" data-preview={choice} aria-hidden>
    <span className="theme-preview-dots" />
    <span className="theme-preview-sidebar" />
    <span className="theme-preview-lines" />
  </span>
)

export const ThemeChoices = ({ labelledBy }: { readonly labelledBy: string }) => {
  const [choice, setChoice] = useAtom(theme)
  const group = useId()

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="theme-choices">
      {choices.map((option) => (
        <label key={option} className="theme-choice">
          <input
            type="radio"
            name={group}
            value={option}
            checked={choice === option}
            onChange={() => {
              setChoice(option)
            }}
          />
          <Preview choice={option} />
          <span className="theme-choice-label">{option}</span>
        </label>
      ))}
    </div>
  )
}

export const SwitchButton = ({
  on,
  labelledBy,
  onToggle,
}: {
  readonly on: boolean
  readonly labelledBy: string
  readonly onToggle: () => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-labelledby={labelledBy}
    className="switch"
    onClick={onToggle}
  >
    <span className="switch-thumb" />
  </button>
)

export const SettingSwitch = ({
  setting,
  labelledBy,
}: {
  readonly setting: Atom.Writable<boolean>
  readonly labelledBy: string
}) => {
  const [on, setOn] = useAtom(setting)

  return (
    <SwitchButton
      on={on}
      labelledBy={labelledBy}
      onToggle={() => {
        setOn(!on)
      }}
    />
  )
}

export const themeLabelOf = (resolved: "light" | "dark") =>
  resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"

export const Appearance = ({ handle }: { readonly handle: PopoverHandle }) => {
  const resolved = useAtomValue(resolvedTheme)
  const themeLabel = useId()
  const wideLabel = useId()

  return (
    <div
      id={handle.id}
      popover="auto"
      role="dialog"
      aria-label="Appearance"
      tabIndex={-1}
      className={names(logseq("menu").className, "appearance")}
      onBeforeToggle={handle.onBeforeToggle}
      onToggle={handle.onToggle}
    >
      <Row label={themeLabelOf(resolved)} labelId={themeLabel} keys={keysOf("ToggleTheme")}>
        <ThemeChoices labelledBy={themeLabel} />
      </Row>
      <Row label="Wide mode" labelId={wideLabel} keys={keysOf("ToggleWideMode")}>
        <SettingSwitch setting={wideMode} labelledBy={wideLabel} />
      </Row>
    </div>
  )
}
