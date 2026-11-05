import { attributesOf, logseq } from "@seqno/dom"
import { defaultKeymap } from "@codemirror/commands"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, tooltips } from "@codemirror/view"
import { Effect, Fiber, Stream } from "effect"
import type { Block, BlockId, Command, PropertyTarget } from "@seqno/domain"
import type { PropertyStyle } from "@seqno/syntax"
import { autopair } from "./autopair.ts"
import type { SlashCommand } from "./commands.ts"
import { completion, createPopupStore } from "./completion.ts"
import type { PopupStore } from "./completion.ts"
import { fromGraph, minimalChange, placeCursor, textSync } from "./edits.ts"
import { blockFields } from "./fields.ts"
import { pasteOutline } from "./paste.ts"
import { headingLevel } from "./format.ts"
import { assetDrops } from "./assets.ts"
import { extraCommands } from "./popup.ts"
import type { Handoff } from "./handoff.ts"
import type { CursorPlacement, EditorHost } from "./host.ts"
import { blockKeymap, propertiesKeymap } from "./keymap.ts"
import { editorTheme } from "./theme.ts"
import { enterInsert, vimMode } from "./vim.ts"

export interface BlockEditorOptions {
  readonly block: Block
  readonly cursor: CursorPlacement
  readonly updates: Stream.Stream<Block>
  readonly host: EditorHost
  readonly handoff: Handoff
  readonly properties?: PropertyTarget
  readonly hidden?: (key: string) => boolean
  readonly propertyStyle?: PropertyStyle
  readonly vim?: boolean
  readonly documentMode?: boolean
  readonly commands?: readonly SlashCommand[]
}

export interface MountedEditor {
  readonly view: EditorView
  readonly popups: PopupStore
  readonly destroy: () => void
}

export interface EditingBlock {
  readonly view: EditorView
  readonly blockId: BlockId
}

const editing = new Map<EditorView, BlockId>()

export const editingBlock = (): EditingBlock | null => {
  const all = [...editing]
  const [view, blockId] = all.find(([candidate]) => candidate.hasFocus) ?? all.at(-1) ?? []

  return view === undefined || blockId === undefined ? null : { view, blockId }
}

const headingClass = EditorView.editorAttributes.compute(["doc"], (state) => {
  const level = headingLevel(state.doc.line(1).text)

  return level === null ? {} : { class: `sq-h${level}` }
})

export const mountBlockEditor = (
  parent: HTMLElement,
  {
    block,
    cursor,
    updates,
    host,
    handoff,
    properties,
    hidden,
    propertyStyle,
    vim = false,
    documentMode = false,
    commands: extra = [],
  }: BlockEditorOptions,
  popups = createPopupStore(),
): MountedEditor => {
  const arrival = handoff.take()
  const target = properties ?? { _tag: "BlockTarget", blockId: block.id }
  const fields = blockFields(block.id, block, target, hidden, propertyStyle)
  const draft = fields.draftOf(block)

  const commit = async (commands: readonly Command[]) => {
    if (!(await host.dispatchAll(commands))) {
      resync()
    }
  }

  const merged =
    arrival?._tag === "Merged"
      ? fields.draftOf({ ...block, text: block.text + arrival.tail })
      : null

  const sync = textSync(draft, merged === null ? [] : [merged])
  const doc = () => view.state.doc.toString()
  let fromHistory = false

  const dispatch = (command: Command) => {
    if (command._tag === "Undo" || command._tag === "Redo") {
      sync.external()
      fromHistory = true
    }

    host.dispatch(
      command._tag === "SplitBlock"
        ? { ...command, at: fields.textCaret(doc(), command.at) }
        : command,
    )
  }

  const waiting: Array<() => void> = []

  const whenConfirmed = (run: () => void) => {
    if (sync.confirmed()) {
      run()
    } else {
      waiting.push(run)
    }
  }

  let parentId = block.parentId
  let seen = block

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: merged ?? draft,
      extensions: [
        vim
          ? vimMode({
              act: host.act,
              history: (step) => {
                dispatch({ _tag: step })
              },
              handoff,
            })
          : [],
        properties === undefined
          ? blockKeymap(
              block.id,
              { ...host, dispatch },
              handoff,
              whenConfirmed,
              fields.textOf,
              documentMode,
            )
          : propertiesKeymap(host),
        completion(block.id, host, popups),
        extraCommands.of(extra),
        assetDrops(host),
        properties === undefined ? pasteOutline(block, () => parentId, host.dispatch) : [],
        autopair,
        keymap.of(defaultKeymap),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          spellcheck: "true",
          autocorrect: "on",
          autocapitalize: "sentences",
        }),
        editorTheme,
        EditorView.editorAttributes.of(attributesOf(logseq("seqno-editor"))),
        EditorView.contentAttributes.compute(["doc"], (state) =>
          attributesOf(
            logseq("seqno-editor-content", block.id, state.doc.toString(), block.props["heading"]),
          ),
        ),
        headingClass,
        tooltips({ parent: parent.ownerDocument.body }),
        EditorView.updateListener.of((update) => {
          for (const transaction of update.transactions) {
            if (transaction.docChanged && transaction.annotation(fromGraph) !== true) {
              fromHistory = false
              const commands = fields.commit(transaction)

              if (commands.length > 0) {
                void commit(commands)
              }

              sync.local(transaction.newDoc.toString())
            }
          }
        }),
      ],
    }),
  })

  if (properties === undefined) {
    editing.set(view, block.id)
  }

  if (vim && !(arrival?._tag === "Caret" && arrival.vim === "Normal")) {
    enterInsert(view)
  }

  const placement =
    merged === null
      ? placeCursor(
          view,
          arrival?._tag === "Caret"
            ? arrival.cursor
            : cursor._tag === "Offset"
              ? { _tag: "Offset", offset: fields.draftCaret(block, cursor.offset) }
              : cursor,
        )
      : EditorSelection.cursor(fields.draftCaret(block, block.text.length))

  view.dispatch({ selection: EditorSelection.create([placement]), scrollIntoView: true })
  view.focus()
  handoff.arrive(view)

  const receive = (next: Block) => {
    seen = next
    const current = view.state.doc.toString()
    const shown = fields.draftOf(next)

    if (sync.isNews(shown)) {
      fields.reset(next)

      if (current !== shown) {
        const change = minimalChange(current, shown)
        view.dispatch({
          changes: change,
          annotations: fromGraph.of(true),
          selection: fromHistory ? { anchor: change.from + change.insert.length } : undefined,
        })
      }

      fromHistory = false
    }

    if (sync.confirmed()) {
      for (const run of waiting.splice(0)) {
        run()
      }
    }

    if (next.parentId !== parentId) {
      parentId = next.parentId

      if (view.state.doc.length === 0) {
        handoff.settle(view)
      }
    }
  }

  const resync = () => {
    sync.external()
    receive(seen)
  }

  const listening = Effect.runFork(
    Stream.runForEach(updates, (next) =>
      Effect.sync(() => {
        receive(next)
      }),
    ),
  )

  return {
    view,
    popups,
    destroy: () => {
      Effect.runFork(Fiber.interrupt(listening))
      editing.delete(view)
      view.destroy()
    },
  }
}
