import { Prec, type EditorState, type Transaction, type TransactionSpec } from "@codemirror/state"
import {
  EditorView,
  keymap,
  showTooltip,
  ViewPlugin,
  type Rect,
  type TooltipView,
} from "@codemirror/view"
import { Effect, Fiber } from "effect"
import type { BlockId } from "@seqno/domain"
import type { SlashCommand } from "./commands.ts"
import { minimalChange } from "./edits.ts"
import type { EditorHost, LinkTarget } from "./host.ts"
import {
  blockChoices,
  Choice,
  choose,
  needsSearch,
  openPopup,
  pageChoices,
  popupField,
  showResults,
  triggers,
  type Popup,
} from "./popup.ts"

export interface PopupFrame {
  readonly popup: Popup
  readonly dom: HTMLElement
  readonly view: EditorView
}

export interface PopupStore {
  readonly frame: () => PopupFrame | null
  readonly subscribe: (listener: () => void) => () => void
}

interface PopupHost extends PopupStore {
  readonly attach: (dom: HTMLElement | null) => void
  readonly sync: (view: EditorView) => void
}

export const createPopupStore = (): PopupStore & PopupHost => {
  let frame: PopupFrame | null = null
  let dom: HTMLElement | null = null
  const listeners = new Set<() => void>()
  return {
    frame: () => frame,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach: (element) => {
      dom = element
    },
    sync: (view) => {
      const popup = view.state.field(popupField)
      const next =
        popup === null || dom === null
          ? null
          : frame?.popup === popup && frame.dom === dom
            ? frame
            : { popup, dom, view }
      if (next === frame) return
      frame = next
      for (const listener of listeners) listener()
    },
  }
}

const lineBox = (view: EditorView, pos: number): Rect => {
  const glyph = view.coordsAtPos(pos, -1) ?? view.coordsAtPos(pos, 1)
  const lineHeight = Number.parseFloat(getComputedStyle(view.contentDOM).lineHeight)
  const height = Number.isNaN(lineHeight) ? view.defaultLineHeight : lineHeight
  const blockTop = view.documentTop + view.lineBlockAt(pos).top
  const row = glyph === null ? 0 : Math.floor(((glyph.top + glyph.bottom) / 2 - blockTop) / height)
  const top = blockTop + row * height
  const left = glyph?.left ?? view.contentDOM.getBoundingClientRect().left
  return { left, right: left, top, bottom: top + height }
}

const popupTooltip = (store: PopupHost) => {
  const create = (view: EditorView): TooltipView => {
    const dom = document.createElement("div")
    dom.className = "sq-popup-host"
    store.attach(dom)
    return {
      dom,
      offset: { x: -20, y: 3 },
      getCoords: (pos) => lineBox(view, pos),
      destroy: () => store.attach(null),
    }
  }
  return showTooltip.compute([popupField], (state) => {
    const popup = state.field(popupField)
    return popup === null ? null : { pos: popup.from, create }
  })
}

const choicesFor = (popup: Popup, blockId: BlockId, host: EditorHost) =>
  popup.kind === "Block"
    ? Effect.map(host.searchBlocks(popup.query), (hits) => blockChoices(hits, popup.query, blockId))
    : Effect.map(host.searchPages(popup.query), (pages) => pageChoices(pages, popup.query))

const searchPlugin = (blockId: BlockId, host: EditorHost) =>
  ViewPlugin.define((view) => {
    let running: Fiber.Fiber<void> | null = null
    let wanted: Popup | null = null
    const stop = () => {
      if (running !== null) Effect.runFork(Fiber.interrupt(running))
      running = null
    }
    const start = (popup: Popup) => {
      stop()
      wanted = popup
      const { kind, from, query } = popup
      running = Effect.runFork(
        Effect.yieldNow.pipe(
          Effect.andThen(choicesFor(popup, blockId, host)),
          Effect.flatMap((choices) =>
            Effect.sync(() =>
              view.dispatch({ effects: showResults.of({ kind, from, query, choices }) }),
            ),
          ),
        ),
      )
    }
    return {
      update: (update) => {
        const popup = update.state.field(popupField)
        const same =
          wanted !== null &&
          popup !== null &&
          wanted.kind === popup.kind &&
          wanted.from === popup.from &&
          wanted.query === popup.query
        if (popup !== null && needsSearch(popup) && popup.searched !== popup.query && !same) {
          start(popup)
        } else if (popup === null || !needsSearch(popup)) {
          stop()
          wanted = null
        }
      },
      destroy: stop,
    }
  })

const step = (state: EditorState, spec: TransactionSpec): Transaction => state.update(spec)

const refText = (popup: Popup, value: string) =>
  popup.kind === "Tag" && /\s/.test(value) ? `[[${value}]]` : value

const closing: Readonly<Record<Popup["kind"], string>> = {
  Page: "]]",
  Block: "))",
  Tag: "",
  Slash: "",
}

const insertRef = (view: EditorView, popup: Popup, value: string) => {
  const { state } = view
  const caret = state.selection.main.head
  const close = closing[popup.kind]
  const closed = close !== "" && state.sliceDoc(caret, caret + close.length) === close
  const insert = refText(popup, value) + (closed ? "" : close)
  view.dispatch({
    changes: { from: popup.from, to: caret, insert },
    selection: { anchor: popup.from + insert.length + (closed ? close.length : 0) },
    userEvent: "input.complete",
    scrollIntoView: true,
  })
}

const runCommand = (view: EditorView, popup: Popup, command: SlashCommand, now: Date) => {
  const slash = popup.from - triggers.Slash.length
  const removed = step(view.state, {
    changes: { from: slash, to: view.state.selection.main.head },
    selection: { anchor: slash },
    userEvent: "input.complete",
  })
  const text = removed.newDoc.toString()
  const applied = command.apply({ text, from: slash, to: slash }, now)
  const { draft } = applied
  const changed = step(removed.state, {
    changes: minimalChange(text, draft.text),
    selection: { anchor: draft.from, head: draft.to },
    effects:
      applied.open === undefined ? [] : [openPopup.of({ kind: applied.open, from: draft.from })],
    userEvent: "input.complete",
    scrollIntoView: true,
  })
  view.dispatch([removed, changed])
}

export const accept = (view: EditorView, index: number, now = new Date()): boolean => {
  const popup = view.state.field(popupField)
  const choice = popup?.choices[index]
  if (popup === null || choice === undefined) return false
  Choice.$match(choice, {
    Journal: ({ title }) => insertRef(view, popup, title),
    Page: ({ title }) => insertRef(view, popup, title),
    NewPage: ({ title }) => insertRef(view, popup, title),
    Block: ({ hit }) => insertRef(view, popup, hit.block.id),
    Command: ({ command }) => runCommand(view, popup, command, now),
  })
  return true
}

export const pick = (view: EditorView, index: number) =>
  view.dispatch({ effects: choose.of({ index, pointer: true }) })

const move = (delta: number) => (view: EditorView) => {
  const popup = view.state.field(popupField)
  if (popup === null || popup.choices.length === 0) return false
  view.dispatch({ effects: choose.of({ index: popup.active + delta, pointer: false }) })
  return true
}

const acceptActive = (view: EditorView) => {
  const popup = view.state.field(popupField)
  return popup !== null && accept(view, popup.active)
}

const targetOf = (choice: Choice): LinkTarget | null =>
  Choice.$match(choice, {
    Journal: ({ title }): LinkTarget => ({ _tag: "Page", name: title }),
    Page: ({ title }): LinkTarget => ({ _tag: "Page", name: title }),
    NewPage: () => null,
    Block: ({ hit }): LinkTarget => ({ _tag: "Block", uuid: hit.block.id }),
    Command: () => null,
  })

const openActive = (host: EditorHost) => (view: EditorView) => {
  const popup = view.state.field(popupField)
  if (popup === null) return false
  const choice = popup.choices[popup.active]
  const target = choice === undefined ? null : targetOf(choice)
  if (target !== null) host.act({ _tag: "Open", target, sidebar: true })
  return true
}

export const completion = (blockId: BlockId, host: EditorHost, store: PopupHost) => [
  popupField,
  popupTooltip(store),
  searchPlugin(blockId, host),
  EditorView.updateListener.of((update) => store.sync(update.view)),
  Prec.highest(
    keymap.of([
      { key: "ArrowDown", run: move(1) },
      { key: "Ctrl-n", run: move(1) },
      { key: "ArrowUp", run: move(-1) },
      { key: "Ctrl-p", run: move(-1) },
      { key: "Enter", run: acceptActive },
      { key: "Mod-Enter", run: acceptActive },
      { key: "Shift-Enter", run: openActive(host) },
    ]),
  ),
]
