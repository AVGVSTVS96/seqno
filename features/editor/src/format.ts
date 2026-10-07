import { Schema } from "effect"
import { Marker, setProperty, type Priority } from "@seqno/syntax"

export interface Draft {
  readonly text: string
  readonly from: number
  readonly to: number
}

export const caretAt = (text: string, at: number): Draft => ({ text, from: at, to: at })

interface Change {
  readonly from: number
  readonly to: number
  readonly insert: string
}

const markerNames = Marker.literals.toSorted((left, right) => right.length - left.length)
const markerPattern = new RegExp(`^(${markerNames.join("|")})(?=[ \\t]|$)`)
const headingPattern = /^#{1,6}[ \t]+/
const priorityPattern = /^\[#[ABC]\][ \t]?/
const url = /^(?:https?:\/\/|www\.)\S+$/

const mapPosition = (change: Change, position: number) =>
  position <= change.from
    ? position
    : position >= change.to
      ? position + change.insert.length - (change.to - change.from)
      : change.from + change.insert.length

const replace = (draft: Draft, change: Change): Draft => ({
  text: draft.text.slice(0, change.from) + change.insert + draft.text.slice(change.to),
  from: mapPosition(change, draft.from),
  to: mapPosition(change, draft.to),
})

const headingLength = (text: string) => headingPattern.exec(text)?.[0].length ?? 0

const markerOf = (text: string) => {
  const start = headingLength(text)
  const found = markerPattern.exec(text.slice(start))?.[1]
  return found === undefined ? null : { name: found, from: start, to: start + found.length }
}

export const setMarker = (draft: Draft, marker: Marker | null): Draft => {
  const start = headingLength(draft.text)
  const current = markerOf(draft.text)
  const end = current === null ? start : current.to
  const spaced = /[ \t]/.test(draft.text.charAt(end)) ? end + 1 : end
  return replace(draft, { from: start, to: spaced, insert: marker === null ? "" : `${marker} ` })
}

const nextMarker: Readonly<Record<Marker, Marker | null>> = {
  TODO: "DOING",
  DOING: "DONE",
  LATER: "NOW",
  NOW: "DONE",
  WAIT: "DONE",
  WAITING: "DONE",
  "IN-PROGRESS": "DONE",
  STARTED: "DONE",
  DONE: null,
  CANCELED: null,
  CANCELLED: null,
}

const isMarker = Schema.is(Marker)

export const cycleMarker = (draft: Draft): Draft => {
  const current = markerOf(draft.text)?.name
  return setMarker(draft, isMarker(current) ? nextMarker[current] : "TODO")
}

export const setPriority = (draft: Draft, priority: Priority | null): Draft => {
  const marker = markerOf(draft.text)
  const afterMarker = marker === null ? headingLength(draft.text) : marker.to
  const start =
    marker !== null && /[ \t]/.test(draft.text.charAt(afterMarker)) ? afterMarker + 1 : afterMarker
  const existing = priorityPattern.exec(draft.text.slice(start))?.[0].length ?? 0
  return replace(draft, {
    from: start,
    to: start + existing,
    insert: priority === null ? "" : `[#${priority}] `,
  })
}

export const setHeading = (draft: Draft, level: number | null): Draft =>
  replace(draft, {
    from: 0,
    to: headingLength(draft.text),
    insert: level === null ? "" : `${"#".repeat(level)} `,
  })

export const headingLevel = (text: string): number | null => {
  const length = headingLength(text)
  return length === 0 ? null : text.slice(0, length).trimEnd().length
}

export const setPlanning = (draft: Draft, kind: "SCHEDULED" | "DEADLINE", date: string): Draft => {
  const stamp = `${kind}: <${date}>`
  const existing = new RegExp(`${kind}: <[^>\\n]*>`).exec(draft.text)
  if (existing !== null) {
    return replace(draft, {
      from: existing.index,
      to: existing.index + existing[0].length,
      insert: stamp,
    })
  }
  const firstLineEnd = draft.text.indexOf("\n")
  const at = firstLineEnd === -1 ? draft.text.length : firstLineEnd
  const from = at - (/[ \t]*$/.exec(draft.text.slice(0, at))?.[0].length ?? 0)
  return replace(draft, { from, to: at, insert: `\n${stamp}` })
}

export const setOrderedList = (draft: Draft): Draft => {
  const edit = setProperty(draft.text, "logseq.order-list-type", "number")
  return edit === null ? draft : replace(draft, edit)
}

export const quoteLine = (draft: Draft): Draft => {
  const lineStart = draft.text.lastIndexOf("\n", draft.from - 1) + 1
  return draft.text.startsWith("> ", lineStart)
    ? draft
    : replace(draft, { from: lineStart, to: lineStart, insert: "> " })
}

const wrappedBy = (text: string, from: number, to: number, mark: string) =>
  text.slice(from - mark.length, from) === mark &&
  text.slice(to, to + mark.length) === mark &&
  (mark.length > 1 || (text.charAt(from - 2) !== mark && text.charAt(to + 1) !== mark))

export const toggleMark = (draft: Draft, mark: string): Draft => {
  const { text, from, to } = draft
  const size = mark.length
  const selected = text.slice(from, to)
  if (wrappedBy(text, from, to, mark)) {
    return {
      text: text.slice(0, from - size) + selected + text.slice(to + size),
      from: from - size,
      to: to - size,
    }
  }
  if (selected.length >= size * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    return {
      text: text.slice(0, from) + selected.slice(size, -size) + text.slice(to),
      from,
      to: to - size * 2,
    }
  }
  return caretAt(text.slice(0, from) + mark + selected + mark + text.slice(to), to + size)
}

export const insertLink = (draft: Draft): Draft => {
  const { text, from, to } = draft
  const selected = text.slice(from, to)
  const labelled = selected !== "" && !url.test(selected)
  const link = labelled ? `[${selected}]()` : `[](${selected})`
  return caretAt(
    text.slice(0, from) + link + text.slice(to),
    labelled ? from + selected.length + 3 : from + 1,
  )
}

export const insertText = (draft: Draft, insert: string, caretFromEnd = 0): Draft =>
  caretAt(
    draft.text.slice(0, draft.from) + insert + draft.text.slice(draft.to),
    draft.from + insert.length - caretFromEnd,
  )
