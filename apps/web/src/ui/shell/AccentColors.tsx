import { useAtom, useAtomValue } from "@effect/atom-react"
import { accentColors, accentScale, type AccentChoice } from "@seqno/dom"
import { resolvedTheme } from "../../atoms.ts"
import { Dialog, useTooltip } from "./popover.tsx"
import { accentColor, accentPickerOpen } from "./state.ts"

const choices: ReadonlyArray<AccentChoice> = ["none", "logseq", ...accentColors]

const labelOf = (choice: AccentChoice) =>
  choice === "none"
    ? "Cancel accent color. This is currently in beta stage and mainly used for compatibility with custom themes."
    : choice === "logseq"
      ? "Logseq classical color"
      : `${choice} color`

const Swatch = ({ choice, dark }: { readonly choice: AccentChoice; readonly dark: boolean }) => {
  const [current, choose] = useAtom(accentColor)
  const hint = useTooltip({ label: labelOf(choice) })
  const scale = choice === "none" || choice === "logseq" ? null : accentScale(choice, dark)
  return (
    <>
      <button
        type="button"
        className="seqno-accent-swatch"
        aria-label={labelOf(choice)}
        aria-pressed={current === choice}
        data-color={choice}
        style={scale === null ? undefined : { "--swatch": scale[8], "--swatch-ring": scale[6] }}
        {...hint.props}
        onClick={() => choose(choice)}
      >
        <span className="seqno-accent-mark" />
      </button>
      {hint.tooltip}
    </>
  )
}

export const AccentColorList = () => {
  const dark = useAtomValue(resolvedTheme) === "dark"
  return (
    <div className="seqno-accent-list" role="group" aria-label="Accent color">
      {choices.map((choice) => (
        <Swatch key={choice} choice={choice} dark={dark} />
      ))}
    </div>
  )
}

const Picker = ({ onClose }: { readonly onClose: () => void }) => (
  <Dialog
    id="seqno-accent-colors"
    label="Accent color"
    className="seqno-accent-colors"
    onClose={onClose}
    ref={(dialog) => {
      if (dialog !== null && !dialog.open) dialog.showModal()
    }}
  >
    <div className="seqno-accent-head">
      <strong>Accent color</strong>
      <p>Choosing an accent color may override any theme you have selected.</p>
    </div>
    <AccentColorList />
  </Dialog>
)

export const AccentColors = () => {
  const [open, setOpen] = useAtom(accentPickerOpen)
  return open ? <Picker onClose={() => setOpen(false)} /> : null
}
