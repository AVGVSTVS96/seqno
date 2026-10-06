import { Fragment } from "react"
import { onMac } from "./shortcuts.ts"

const modifiers = new Set(["mod", "alt", "shift", "ctrl"])

const labels: Readonly<Record<string, string>> = {
  mod: onMac ? "⌘" : "Ctrl",
  alt: onMac ? "⌥" : "Alt",
  shift: "⇧",
  ctrl: "Ctrl",
  enter: "⏎",
}

const labelOf = (key: string) => labels[key] ?? (key.length === 1 ? key.toUpperCase() : key)

export const Keys = ({
  keys,
  framed = false,
}: {
  readonly keys: ReadonlyArray<string>
  readonly framed?: boolean
}) =>
  keys.some((key) => modifiers.has(key)) ? (
    <span className={framed ? "keys-combo keys-framed" : "keys-combo"}>
      {keys.map((key, index) => (
        <Fragment key={key}>
          {index === 0 ? null : <span className="keys-separator" />}
          <kbd className="key">{labelOf(key)}</kbd>
        </Fragment>
      ))}
    </span>
  ) : (
    <span className={framed ? "keys-sequence keys-framed" : "keys-sequence"}>
      {keys.map((key, index) => (
        <kbd key={`${index}-${key}`} className="key">
          {labelOf(key)}
        </kbd>
      ))}
    </span>
  )
