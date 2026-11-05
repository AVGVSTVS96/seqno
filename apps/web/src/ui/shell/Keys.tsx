import { logseq, names } from "@seqno/dom"
import { Fragment } from "react"
import { onMac } from "./shortcuts.ts"

const modifiers = new Set(["mod", "alt", "shift", "ctrl"])

const labels: Readonly<Record<string, string>> = {
  mod: onMac ? "⌘" : "Ctrl",
  alt: onMac ? "⌥" : "Alt",
  shift: "⇧",
  ctrl: "Ctrl",
  enter: "⏎",
  tab: "Tab",
  escape: "Esc",
  backspace: "Backspace",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
}

const labelOf = (key: string) => labels[key] ?? (key.length === 1 ? key.toUpperCase() : key)

export const Keys = ({
  keys,
  framed,
  combo,
}: {
  readonly keys: readonly string[]
  readonly framed?: boolean
  readonly combo?: boolean
}) =>
  (combo ?? keys.some((key) => modifiers.has(key))) ? (
    <span className={names(logseq("seqno-keys").className, "keys-combo", framed && "keys-framed")}>
      {keys.map((key, index) => (
        <Fragment key={key}>
          {index === 0 ? null : <span className="keys-separator" />}
          <kbd className="key">{labelOf(key)}</kbd>
        </Fragment>
      ))}
    </span>
  ) : (
    <span
      className={names(logseq("seqno-keys").className, "keys-sequence", framed && "keys-framed")}
    >
      {keys.map((key, index) => (
        <kbd key={`${index}-${key}`} className="key">
          {labelOf(key)}
        </kbd>
      ))}
    </span>
  )
