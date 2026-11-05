import { Facet, StateEffect, StateField } from "@codemirror/state"
import type { EditorState, Transaction } from "@codemirror/state"
import { Data } from "effect"
import { normalizePageName } from "@seqno/domain"
import type { BlockId } from "@seqno/domain"
import { slashCommands } from "./commands.ts"
import type { SlashCommand } from "./commands.ts"
import { journalTitle, shiftDays, shiftMonths } from "./dates.ts"
import { rankBy, scatteredKind } from "./fuzzy.ts"
import type { Range } from "./fuzzy.ts"
import type { BlockHit, PageName } from "./host.ts"

export type PopupKind = "Page" | "Tag" | "Block" | "Slash"

export type Choice = Data.TaggedEnum<{
  Journal: { readonly label: string; readonly title: string }
  Page: { readonly title: string; readonly ranges: readonly Range[] }
  NewPage: { readonly title: string }
  Block: { readonly hit: BlockHit; readonly text: string; readonly ranges: readonly Range[] }
  Command: { readonly command: SlashCommand; readonly ranges: readonly Range[] }
}>

export const Choice = Data.taggedEnum<Choice>()

export interface Popup {
  readonly kind: PopupKind
  readonly from: number
  readonly query: string
  readonly choices: readonly Choice[]
  readonly searched: string | null
  readonly active: number
  readonly pointer: boolean
  readonly accepting: boolean
}

export interface Results {
  readonly kind: PopupKind
  readonly from: number
  readonly query: string
  readonly choices: readonly Choice[]
}

export const openPopup = StateEffect.define<{ readonly kind: PopupKind; readonly from: number }>()
export const closePopup = StateEffect.define()
export const showResults = StateEffect.define<Results>()
export const choose = StateEffect.define<{ readonly index: number; readonly pointer: boolean }>()
export const acceptOnArrival = StateEffect.define()

export const triggers: Readonly<Record<PopupKind, string>> = {
  Page: "[[",
  Block: "((",
  Tag: "#",
  Slash: "/",
}

const tagCharacters = /^[^\s,;!?"'()[\]{}#]*$/u

const validQuery: Readonly<Record<PopupKind, (query: string) => boolean>> = {
  Page: (query) => !/\]\]|\[\[|\n/u.test(query),
  Block: (query) => !/\)\)|\n/u.test(query),
  Tag: (query) => tagCharacters.test(query),
  Slash: (query) => !query.includes("\n") && !/^\s/u.test(query),
}

export const needsSearch = (popup: Popup) => popup.kind !== "Slash" && popup.query.trim() !== ""

export const extraCommands = Facet.define<readonly SlashCommand[], readonly SlashCommand[]>({
  combine: (lists) => lists.flat(),
})

export const commandChoices = (
  query: string,
  commands: readonly SlashCommand[] = slashCommands,
): readonly Choice[] =>
  query.trim() === ""
    ? commands.map((command) => Choice.Command({ command, ranges: [] }))
    : rankBy(commands, (command) => command.label, query).map(({ item, match }) =>
        Choice.Command({ command: item, ranges: match.ranges }),
      )

const relativeDays: ReadonlyArray<readonly [string, (now: Date) => Date]> = [
  ["Today", (now) => now],
  ["Tomorrow", (now) => shiftDays(now, 1)],
  ["Yesterday", (now) => shiftDays(now, -1)],
  ["Next week", (now) => shiftDays(now, 7)],
  ["This week", (now) => now],
  ["Last week", (now) => shiftDays(now, -7)],
  ["Next month", (now) => shiftMonths(now, 1)],
  ["This month", (now) => now],
  ["Last month", (now) => shiftMonths(now, -1)],
  ["Next year", (now) => shiftMonths(now, 12)],
]

const journalChoices = (now: Date): readonly Choice[] =>
  relativeDays.map(([label, day]) => Choice.Journal({ label, title: journalTitle(day(now)) }))

const localChoices = (
  state: EditorState,
  kind: PopupKind,
  query: string,
): readonly Choice[] | null => {
  if (kind === "Slash") {
    return commandChoices(query, [...slashCommands, ...state.facet(extraCommands)])
  }

  if (query.trim() !== "") {
    return null
  }

  return kind === "Page" ? journalChoices(new Date()) : []
}

const opened = (state: EditorState, kind: PopupKind, from: number): Popup => {
  const query = state.sliceDoc(from, state.selection.main.head)
  const local = localChoices(state, kind, query)

  return {
    kind,
    from,
    query,
    choices: local ?? [],
    searched: local === null ? null : query,
    active: 0,
    pointer: false,
    accepting: false,
  }
}

const tracked = (popup: Popup, tr: Transaction): Popup | null => {
  if (!tr.docChanged && !tr.selection) {
    return popup
  }

  const { state } = tr
  const from = tr.changes.mapPos(popup.from, -1)
  const caret = state.selection.main
  const trigger = triggers[popup.kind]

  if (!caret.empty || caret.head < from) {
    return null
  }

  if (state.sliceDoc(from - trigger.length, from) !== trigger) {
    return null
  }

  const query = state.sliceDoc(from, caret.head)

  if (!validQuery[popup.kind](query)) {
    return null
  }

  if (query === popup.query) {
    return from === popup.from ? popup : { ...popup, from }
  }

  const local = localChoices(state, popup.kind, query)

  if (popup.kind === "Slash" && local !== null && local.length === 0) {
    return null
  }

  return {
    ...popup,
    from,
    query,
    choices: local ?? popup.choices,
    searched: local === null ? popup.searched : query,
    active: 0,
    pointer: false,
    accepting: false,
  }
}

const startsWord = (state: EditorState, at: number) =>
  at === 0 || /\s/u.test(state.sliceDoc(at - 1, at))

const detected = (state: EditorState): Popup | null => {
  const head = state.selection.main.head
  const typed = state.sliceDoc(head - 2, head)

  if (typed === "[[") {
    return opened(state, "Page", head)
  }

  if (typed === "((") {
    return opened(state, "Block", head)
  }

  const last = typed.slice(-1)

  if (last === "#" && startsWord(state, head - 1)) {
    return opened(state, "Tag", head)
  }

  if (last === "/" && startsWord(state, head - 1)) {
    return opened(state, "Slash", head)
  }

  return null
}

const withEffects = (state: EditorState, popup: Popup | null, tr: Transaction) => {
  let next = popup

  for (const effect of tr.effects) {
    if (effect.is(openPopup)) {
      next = opened(state, effect.value.kind, effect.value.from)
    } else if (effect.is(closePopup)) {
      next = null
    } else if (effect.is(showResults)) {
      const { kind, from, query, choices } = effect.value

      if (next !== null && next.kind === kind && next.from === from && next.query === query) {
        next = { ...next, choices, searched: query, active: 0, pointer: false }
      }
    } else if (effect.is(choose) && next !== null && next.choices.length > 0) {
      const count = next.choices.length
      const active = ((effect.value.index % count) + count) % count
      next = { ...next, active, pointer: effect.value.pointer }
    } else if (effect.is(acceptOnArrival) && next !== null) {
      next = { ...next, accepting: true }
    }
  }

  return next
}

export const popupField = StateField.define<Popup | null>({
  create: () => null,
  update: (popup, tr) => {
    const next = withEffects(tr.state, popup === null ? null : tracked(popup, tr), tr)

    if (next !== null || !tr.isUserEvent("input.type")) {
      return next
    }

    return detected(tr.state)
  },
})

const pageLimit = 20
const blockLimit = 10

export const pageChoices = (pages: readonly PageName[], query: string): readonly Choice[] => {
  const wanted = query.trim()
  const found = rankBy(pages, (page) => page.title, wanted)
  const close = found.filter(({ match }) => match.kind !== scatteredKind)

  const ranked = (close.length > 0 ? close : found)
    .slice(0, pageLimit)
    .map(({ item, match }) => Choice.Page({ title: item.title, ranges: match.ranges }))

  if (wanted === "" || pages.some((page) => page.name === normalizePageName(wanted))) {
    return ranked
  }

  const fresh = Choice.NewPage({ title: wanted })
  const [first, ...rest] = ranked

  return first !== undefined && first.title.toLowerCase().startsWith(wanted.toLowerCase())
    ? [first, fresh, ...rest]
    : [fresh, ...ranked]
}

const flat = (text: string) => text.replaceAll(/\s*\n\s*/gu, " ")

const occurrence = (text: string, word: string): readonly Range[] => {
  const at = text.toLowerCase().indexOf(word.toLowerCase())

  return at === -1 || word === "" ? [] : [[at, at + word.length]]
}

const queryRanges = (text: string, query: string): readonly Range[] => {
  const whole = occurrence(text, query.trim())

  return whole.length > 0
    ? whole
    : query
        .trim()
        .split(/\s+/u)
        .flatMap((word) => occurrence(text, word))
        .toSorted((left, right) => left[0] - right[0])
}

export const blockChoices = (
  hits: readonly BlockHit[],
  query: string,
  except: BlockId,
): readonly Choice[] =>
  hits
    .filter((hit) => hit.block.id !== except && hit.block.text.trim() !== "")
    .slice(0, blockLimit)
    .map((hit) => {
      const text = flat(hit.block.text)

      return Choice.Block({ hit, text, ranges: queryRanges(text, query) })
    })
