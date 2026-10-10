import hintsCss from "./hints.css?inline"
import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconX } from "@tabler/icons-react"
import { useRouter } from "@tanstack/react-router"
import { Keys } from "../shell/Keys.tsx"
import { anchorName, dismissHint, hintState, hintTracker } from "./hints.ts"

export const Hints = () => {
  useAtomMount(hintTracker(useRouter()))
  const { active, shown } = useAtomValue(hintState)
  const dismiss = useAtomSet(dismissHint)
  return (
    <>
      <style href="seqno/hints" precedence="app">
        {hintsCss}
      </style>
      {shown.map(({ id, key, spot }) => {
        const open = key === active
        return (
          <div
            key={`${key} ${spot.selector}`}
            role="note"
            aria-label="Tip"
            className="hint"
            data-hint={id}
            data-open={open}
            aria-hidden={!open}
            inert={!open}
            style={{ "--hint-anchor": anchorName(id) }}
          >
            <p className="hint-text">
              {spot.text}
              {spot.keys === undefined ? null : (
                <span className="hint-keys">
                  <Keys keys={spot.keys} framed />
                </span>
              )}
            </p>
            <button
              type="button"
              className="hint-close"
              aria-label="Dismiss tip"
              onClick={() => dismiss(key)}
            >
              <IconX size={14} stroke={2} aria-hidden />
            </button>
          </div>
        )
      })}
    </>
  )
}
