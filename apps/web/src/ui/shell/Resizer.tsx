import { useState, type KeyboardEvent, type PointerEvent } from "react"

export interface Drag {
  readonly onMove: (pointerX: number) => void
  readonly onEnd: () => void
}

export const Resizer = ({
  className,
  label,
  value,
  min,
  max,
  onStart,
  onKey,
}: {
  readonly className: string
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onStart: () => Drag
  readonly onKey?: (event: KeyboardEvent<HTMLDivElement>) => void
}) => {
  const [drag, setDrag] = useState<Drag | null>(null)
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    drag.onEnd()
    setDrag(null)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={onKey === undefined ? -1 : 0}
      className={className}
      data-dragging={drag !== null}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag(onStart())
      }}
      onPointerMove={(event) => drag?.onMove(event.clientX)}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKey}
    />
  )
}
