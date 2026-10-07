import { Prec, StateEffect, StateField } from "@codemirror/state"
import { EditorView, keymap, showTooltip, type Rect, type TooltipView } from "@codemirror/view"
import { planningDate } from "./dates.ts"
import { minimalChange } from "./edits.ts"
import { setPlanning, type Draft } from "./format.ts"

export type Planning = "SCHEDULED" | "DEADLINE"

export const repeatUnits = ["h", "d", "w", "m", "y"] as const
export type RepeatUnit = (typeof repeatUnits)[number]

export interface Repeater {
  readonly count: number
  readonly unit: RepeatUnit
}

export interface Planned {
  readonly date: Date
  readonly time: string | null
  readonly repeater: Repeater | null
}

export const openDatePicker = StateEffect.define<Planning>()
export const closeDatePicker = StateEffect.define<null>()

export const datePickerField = StateField.define<Planning | null>({
  create: () => null,
  update: (open, tr) => {
    let next = tr.docChanged && tr.isUserEvent("input") ? null : open
    for (const effect of tr.effects) {
      if (effect.is(openDatePicker)) next = effect.value
      else if (effect.is(closeDatePicker)) next = null
    }
    return next
  },
})

export const stampOf = ({ date, time, repeater }: Planned) =>
  [
    planningDate(date),
    ...(time === null ? [] : [time]),
    ...(repeater === null ? [] : [`.+${repeater.count}${repeater.unit}`]),
  ].join(" ")

const planned = /^(\d{4})-(\d{2})-(\d{2})/

export const plannedDate = (text: string, kind: Planning): Date | null => {
  const stamp = new RegExp(`${kind}: <([^>\\n]*)>`).exec(text)?.[1]
  const [, year, month, day] = planned.exec(stamp ?? "") ?? []
  return year === undefined ? null : new Date(Number(year), Number(month) - 1, Number(day))
}

export const submitDate = (view: EditorView, kind: Planning, chosen: Planned) => {
  const draft: Draft = {
    text: view.state.doc.toString(),
    from: view.state.selection.main.from,
    to: view.state.selection.main.to,
  }
  const next = setPlanning(draft, kind, stampOf(chosen))
  view.dispatch({
    changes: minimalChange(draft.text, next.text),
    selection: { anchor: next.from, head: next.to },
    effects: closeDatePicker.of(null),
    userEvent: "input.complete",
  })
  view.focus()
}

export interface DatePickerFrame {
  readonly kind: Planning
  readonly dom: HTMLElement
  readonly view: EditorView
}

export interface DatePickerHost {
  readonly attach: (dom: HTMLElement | null) => void
}

const pickerGap = 2

const editorBox = (view: EditorView): Rect => {
  const box = view.dom.getBoundingClientRect()
  return { left: box.left, right: box.left, top: box.top, bottom: box.bottom }
}

const pickerTooltip = (host: DatePickerHost) => {
  const create = (view: EditorView): TooltipView => {
    const dom = document.createElement("div")
    dom.className = "sq-date-host"
    host.attach(dom)
    return {
      dom,
      offset: { x: 0, y: pickerGap },
      getCoords: () => editorBox(view),
      destroy: () => host.attach(null),
    }
  }
  return showTooltip.compute([datePickerField], (state) =>
    state.field(datePickerField) === null ? null : { pos: 0, create },
  )
}

const closeOnEscape = Prec.highest(
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (view.state.field(datePickerField) === null) return false
        view.dispatch({ effects: closeDatePicker.of(null) })
        return true
      },
    },
  ]),
)

export const datePicker = (host: DatePickerHost) => [
  datePickerField,
  pickerTooltip(host),
  closeOnEscape,
]
