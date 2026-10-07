import { useAtom, useAtomValue } from "@effect/atom-react"
import { useId, type ReactNode } from "react"
import { resolvedTheme, theme, type ThemeChoice } from "../../atoms.ts"
import { Keys } from "./Keys.tsx"
import type { PopoverHandle } from "./popover.tsx"
import { keysOf } from "./shortcuts.ts"
import { wideMode } from "./state.ts"

const choices: ReadonlyArray<ThemeChoice> = ["light", "dark", "system"]

const Row = ({
  label,
  labelId,
  keys,
  children,
}: {
  readonly label: string
  readonly labelId: string
  readonly keys: ReadonlyArray<string>
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
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="theme-choices">
      {choices.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={choice === option}
          className="theme-choice"
          onClick={() => setChoice(option)}
        >
          <Preview choice={option} />
          <span className="theme-choice-label">{option}</span>
        </button>
      ))}
    </div>
  )
}

export const WideModeSwitch = ({ labelledBy }: { readonly labelledBy: string }) => {
  const [wide, setWide] = useAtom(wideMode)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={wide}
      aria-labelledby={labelledBy}
      className="switch"
      onClick={() => setWide(!wide)}
    >
      <span className="switch-thumb" />
    </button>
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
      className="menu appearance"
      onBeforeToggle={handle.onBeforeToggle}
      onToggle={handle.onToggle}
    >
      <Row label={themeLabelOf(resolved)} labelId={themeLabel} keys={keysOf("ToggleTheme")}>
        <ThemeChoices labelledBy={themeLabel} />
      </Row>
      <Row label="Wide mode" labelId={wideLabel} keys={keysOf("ToggleWideMode")}>
        <WideModeSwitch labelledBy={wideLabel} />
      </Row>
    </div>
  )
}
