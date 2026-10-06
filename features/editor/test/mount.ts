import { EditorView, runScopeHandlers } from "@codemirror/view"
import { Effect, Stream } from "effect"
import { BlockId, PageId, type Block, type Command, type Page } from "@seqno/domain"
import {
  createHandoff,
  mountBlockEditor,
  type BlockHit,
  type CursorPlacement,
  type EditorAction,
  type Handoff,
} from "@seqno/editor"

export const blockId = BlockId.make("01920000-0000-7000-8000-000000000001")
export const otherBlockId = BlockId.make("01920000-0000-7000-8000-000000000002")
export const parentBlockId = BlockId.make("01920000-0000-7000-8000-000000000003")
export const pageId = PageId.make("01920000-0000-7000-8000-0000000000aa")

export const page = (title: string): Page => ({
  id: pageId,
  name: title.toLowerCase(),
  title,
  journalDay: null,
  props: {},
})

export const blockOf = (
  text: string,
  id: BlockId = blockId,
  parentId: BlockId | null = null,
): Block => ({
  id,
  pageId,
  parentId,
  text,
  collapsed: false,
  props: {},
})

const hit: BlockHit = { block: blockOf("ship the editor", otherBlockId), path: ["Roadmap"] }

export interface Session {
  readonly commands: Array<Command>
  readonly actions: Array<EditorAction>
  readonly searches: Array<string>
  readonly handoff: Handoff
  readonly pages: Array<Page>
}

export const session = (): Session => ({
  commands: [],
  actions: [],
  searches: [],
  handoff: createHandoff(),
  pages: [page("Project X"), page("Projects"), page("Garden Plan")],
})

const mounted: Array<() => void> = []

export const unmountAll = () => {
  for (const destroy of mounted.splice(0)) destroy()
  window.dispatchEvent(new Event("pointerdown"))
  document.body.replaceChildren()
}

export const mount = (
  text: string,
  cursor: CursorPlacement,
  {
    within = session(),
    updates = Stream.never,
    block = blockOf(text),
  }: {
    readonly within?: Session
    readonly updates?: Stream.Stream<Block>
    readonly block?: Block
  } = {},
) => {
  const editor = mountBlockEditor(document.body.appendChild(document.createElement("div")), {
    block,
    cursor,
    updates,
    handoff: within.handoff,
    host: {
      dispatch: (command) => within.commands.push(command),
      act: (action) => within.actions.push(action),
      searchPages: (query) =>
        Effect.sync(() => {
          within.searches.push(`page:${query}`)
          return within.pages
        }),
      searchBlocks: (query) =>
        Effect.sync(() => {
          within.searches.push(`block:${query}`)
          return [hit]
        }),
    },
  })
  mounted.push(editor.destroy)
  return { ...within, view: editor.view, popups: editor.popups, destroy: editor.destroy }
}

export const press = (view: EditorView, key: string, modifiers: KeyboardEventInit = {}) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...modifiers }), "editor")

export const typeKeys = (view: EditorView, text: string) => {
  for (const key of text) {
    const { from, to } = view.state.selection.main
    const insert = () =>
      view.state.update({
        changes: { from, to, insert: key },
        selection: { anchor: from + key.length },
        userEvent: "input.type",
      })
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, from, to, key, insert))
    if (!handled) view.dispatch(insert())
  }
}

export const keyOnWindow = (key: string, modifiers: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...modifiers }))

export const caret = (view: EditorView) => view.state.selection.main.head

export const text = (view: EditorView) => view.state.doc.toString()
