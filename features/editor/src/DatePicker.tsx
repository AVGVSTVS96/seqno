import { IconChevronDown, IconX } from "@tabler/icons-react"
import { useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { clockTime, shiftDays } from "./dates.ts"
import {
  closeDatePicker,
  plannedDate,
  repeatUnits,
  submitDate,
  type DatePickerFrame,
  type Repeater,
  type RepeatUnit,
} from "./planning.ts"

const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const

const sameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()

export const monthGrid = (month: Date): ReadonlyArray<ReadonlyArray<Date>> => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = shiftDays(first, -first.getDay())
  return Array.from({ length: 6 }, (_row, week) =>
    Array.from({ length: 7 }, (_cell, day) => shiftDays(start, week * 7 + day)),
  )
}

const monthTitle = (month: Date) =>
  month.toLocaleString("en-US", { month: "long", year: "numeric" })

const keepFocus = (event: { readonly target: EventTarget; preventDefault: () => void }) => {
  if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) {
    event.preventDefault()
  }
}

const isUnit = (value: string): value is RepeatUnit => repeatUnits.some((unit) => unit === value)

const Remove = ({ label, onClick }: { readonly label: string; readonly onClick: () => void }) => (
  <button type="button" className="sq-date-remove" aria-label={label} onClick={onClick}>
    <IconX size={20} stroke={2} aria-hidden />
  </button>
)

export const DatePicker = ({ frame }: { readonly frame: DatePickerFrame }) => {
  const { kind, view, dom } = frame
  const [now] = useState(() => new Date())
  const [chosen, setChosen] = useState(
    () => plannedDate(view.state.doc.toString(), kind) ?? new Date(now),
  )
  const [month, setMonth] = useState(() => new Date(chosen.getFullYear(), chosen.getMonth(), 1))
  const [time, setTime] = useState<string | null>(null)
  const [repeater, setRepeater] = useState<Repeater | null>(null)
  const close = () => {
    view.dispatch({ effects: closeDatePicker.of(null) })
    view.focus()
  }
  const submit = () => submitDate(view, kind, { date: chosen, time, repeater })
  const turn = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      close()
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault()
      submit()
    }
  }
  return createPortal(
    <div
      className="sq-date"
      role="dialog"
      aria-label={kind === "SCHEDULED" ? "Scheduled date" : "Deadline date"}
      onMouseDown={keepFocus}
      onKeyDown={onKeyDown}
    >
      <div className="sq-date-calendar">
        <table role="grid" aria-label={monthTitle(month)}>
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className="sq-date-turn"
                  aria-label="Previous month"
                  onClick={() => turn(-1)}
                >
                  {"<"}
                </button>
              </th>
              <th colSpan={5} className="sq-date-month">
                {monthTitle(month)}
              </th>
              <th>
                <button
                  type="button"
                  className="sq-date-turn"
                  aria-label="Next month"
                  onClick={() => turn(1)}
                >
                  {">"}
                </button>
              </th>
            </tr>
            <tr>
              {weekdays.map((day) => (
                <th key={day} className="sq-date-weekday">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid(month).map((week) => (
              <tr key={week[0]?.toDateString()}>
                {week.map((day) => (
                  <td
                    key={day.toDateString()}
                    role="gridcell"
                    aria-selected={sameDay(day, chosen)}
                    data-off={day.getMonth() !== month.getMonth() || undefined}
                    className="sq-date-day"
                    onClick={() => {
                      setChosen(day)
                      if (day.getMonth() !== month.getMonth()) {
                        setMonth(new Date(day.getFullYear(), day.getMonth(), 1))
                      }
                    }}
                  >
                    {day.getDate()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sq-date-options">
        <p className="sq-date-label">Time:</p>
        {time === null ? (
          <button type="button" className="sq-date-add" onClick={() => setTime(clockTime(now))}>
            Add time
          </button>
        ) : (
          <div className="sq-date-row">
            <input
              className="sq-date-input sq-date-time"
              aria-label="Time"
              value={time}
              onChange={(event) => setTime(event.currentTarget.value)}
            />
            <Remove label="Remove time" onClick={() => setTime(null)} />
          </div>
        )}
        <p className="sq-date-label">Repeater:</p>
        {repeater === null ? (
          <button
            type="button"
            className="sq-date-add"
            onClick={() => setRepeater({ count: 1, unit: "d" })}
          >
            Add repeater
          </button>
        ) : (
          <div className="sq-date-row">
            <input
              className="sq-date-input sq-date-count"
              aria-label="Repeat every"
              inputMode="numeric"
              value={repeater.count}
              onChange={(event) => {
                const count = Number.parseInt(event.currentTarget.value, 10)
                setRepeater({ ...repeater, count: Number.isNaN(count) ? 1 : Math.max(1, count) })
              }}
            />
            <span className="sq-date-select">
              <select
                className="sq-date-input sq-date-unit"
                aria-label="Repeat unit"
                value={repeater.unit}
                onChange={(event) => {
                  const unit = event.currentTarget.value
                  if (isUnit(unit)) setRepeater({ ...repeater, unit })
                }}
              >
                {repeatUnits.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <IconChevronDown size={18} stroke={2} aria-hidden />
            </span>
            <Remove label="Remove repeater" onClick={() => setRepeater(null)} />
          </div>
        )}
        <p className="sq-date-submit">
          <button type="button" className="sq-date-button" onClick={submit}>
            Submit
          </button>
        </p>
      </div>
    </div>,
    dom,
  )
}
