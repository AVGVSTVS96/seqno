import { defaultKeymap } from "@codemirror/commands"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, tooltips } from "@codemirror/view"
import { Effect, Fiber, Stream } from "effect"
import type { Block, Command, PropertyTarget } from "@seqno/domain"
import { autopair } from "./autopair.ts"
import { completion, createPopupStore, type PopupStore } from "./completion.ts"
import { fromGraph, minimalChange, placeCursor, textSync } from "./edits.ts"
import { blockFields } from "./fields.ts"
import { pasteOutline } from "./paste.ts"
import { headingLevel } from "./format.ts"
import type { Handoff } from "./handoff.ts"
import type { CursorPlacement, EditorHost } from "./host.ts"
import { blockKeymap, propertiesKeymap } from "./keymap.ts"
import { editorTheme } from "./theme.ts"

export interface BlockEditorOptions {
  readonly block: Block
  readonly cursor: CursorPlacement
  readonly updates: Stream.Stream<Block>
  readonly host: EditorHost
  readonly handoff: Handoff
  readonly properties?: PropertyTarget
  readonly hidden?: (key: string) => boolean
}

export interface MountedEditor {
  readonly view: EditorView
  readonly popups: PopupStore
  readonly destroy: () => void
}

const headingClass = EditorView.editorAttributes.compute(["doc"], (state) => {
  const level = headingLevel(state.doc.line(1).text)
  return level === null ? {} : { class: `sq-h${level}` }
})

export const mountBlockEditor = (
  parent: HTMLElement,
  { block, cursor, updates, host, handoff, properties, hidden }: BlockEditorOptions,
  popups = createPopupStore(),
): MountedEditor => {
  const arrival = handoff.take()
  const fields = blockFields(block.id, block, properties, hidden)
  const draft = fields.draftOf(block)
  const merged =
    arrival?._tag === "Merged"
      ? fields.draftOf({ ...block, text: block.text + arrival.tail })
      : null
  const sync = textSync(draft, merged === null ? [] : [merged])
  const doc = () => view.state.doc.toString()
  const dispatch = (command: Command) => {
    if (command._tag === "Undo" || command._tag === "Redo") sync.external()
    host.dispatch(
      command._tag === "SplitBlock"
        ? { ...command, at: fields.textCaret(doc(), command.at) }
        : command,
    )
  }
  const waiting: Array<() => void> = []
  const whenConfirmed = (run: () => void) => {
    if (sync.confirmed()) run()
    else waiting.push(run)
  }
  let parentId = block.parentId

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: merged ?? draft,
      extensions: [
        properties === undefined
          ? blockKeymap(block.id, { ...host, dispatch }, handoff, whenConfirmed, fields.textOf)
          : propertiesKeymap(host),
        completion(block.id, host, popups),
        properties === undefined ? pasteOutline(block, () => parentId, host.dispatch) : [],
        autopair,
        keymap.of(defaultKeymap),
        EditorView.lineWrapping,
        editorTheme,
        headingClass,
        tooltips({ parent: parent.ownerDocument.body }),
        EditorView.updateListener.of((update) => {
          for (const transaction of update.transactions) {
            if (transaction.docChanged && transaction.annotation(fromGraph) !== true) {
              for (const command of fields.commit(transaction)) host.dispatch(command)
              sync.local(transaction.newDoc.toString())
            }
          }
        }),
      ],
    }),
  })

  const placement =
    merged !== null
      ? EditorSelection.cursor(fields.draftCaret(block, block.text.length))
      : placeCursor(
          view,
          arrival?._tag === "Caret"
            ? arrival.cursor
            : cursor._tag === "Offset"
              ? { _tag: "Offset", offset: fields.draftCaret(block, cursor.offset) }
              : cursor,
        )
  view.dispatch({ selection: EditorSelection.create([placement]), scrollIntoView: true })
  view.focus()
  handoff.arrive(view)

  const receive = (next: Block) => {
    const current = view.state.doc.toString()
    const shown = fields.draftOf(next)
    if (sync.isNews(shown)) {
      fields.reset(next)
      if (current !== shown) {
        view.dispatch({
          changes: minimalChange(current, shown),
          annotations: fromGraph.of(true),
        })
      }
    }
    if (sync.confirmed()) for (const run of waiting.splice(0)) run()
    if (next.parentId !== parentId) {
      parentId = next.parentId
      if (view.state.doc.length === 0) handoff.settle(view)
    }
  }

  const listening = Effect.runFork(
    Stream.runForEach(updates, (next) => Effect.sync(() => receive(next))),
  )

  return {
    view,
    popups,
    destroy: () => {
      Effect.runFork(Fiber.interrupt(listening))
      view.destroy()
    },
  }
}
