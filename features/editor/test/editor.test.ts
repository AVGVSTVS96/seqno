import { acceptCompletion, currentCompletions, startCompletion } from "@codemirror/autocomplete"
import { EditorSelection } from "@codemirror/state"
import { runScopeHandlers, type EditorView } from "@codemirror/view"
import { afterEach, assert, describe, it, vi } from "@effect/vitest"
import { Effect, PubSub, Stream } from "effect"
import { BlockId, PageId, type Block, type Command, type Page } from "@seqno/domain"
import { mountBlockEditor, type CursorPlacement, type Navigation } from "@seqno/editor"

const blockId = BlockId.make("01920000-0000-7000-8000-000000000001")
const otherBlockId = BlockId.make("01920000-0000-7000-8000-000000000002")
const pageId = PageId.make("01920000-0000-7000-8000-0000000000aa")

const page = (title: string): Page => ({
  id: pageId,
  name: title.toLowerCase(),
  title,
  journalDay: null,
  props: {},
})

const block: Block = {
  id: otherBlockId,
  pageId,
  parentId: null,
  text: "ship the editor",
  collapsed: false,
  props: {},
}

const mounted: Array<() => void> = []
afterEach(() => {
  for (const destroy of mounted.splice(0)) {
    destroy()
  }
})

const mount = (
  text: string,
  cursor: CursorPlacement,
  textUpdates: Stream.Stream<string> = Stream.never,
) => {
  const commands: Array<Command> = []
  const navigations: Array<Navigation> = []
  const searches: Array<string> = []
  const editor = mountBlockEditor(document.body.appendChild(document.createElement("div")), {
    blockId,
    text,
    cursor,
    textUpdates,
    host: {
      dispatch: (command) => commands.push(command),
      navigate: (navigation) => navigations.push(navigation),
      searchPages: (query) =>
        Effect.sync(() => {
          searches.push(`page:${query}`)
          return [page("Project X"), page("Projects")]
        }),
      searchBlocks: (query) =>
        Effect.sync(() => {
          searches.push(`block:${query}`)
          return [block]
        }),
    },
  })
  mounted.push(editor.destroy)
  return { view: editor.view, commands, navigations, searches }
}

const press = (view: EditorView, key: string, modifiers: KeyboardEventInit = {}) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...modifiers }), "editor")

const type = (view: EditorView, insert: string) => {
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.type",
  })
}

const caret = (view: EditorView) => view.state.selection.main.head

const complete = async (text: string, offset: number) => {
  const editor = mount(text, { _tag: "Offset", offset })
  startCompletion(editor.view)
  await vi.waitFor(() => assert.isAbove(currentCompletions(editor.view.state).length, 0))
  const labels = currentCompletions(editor.view.state).map((option) => option.label)
  await vi.waitFor(() => assert.isTrue(acceptCompletion(editor.view)))
  return { ...editor, labels }
}

const styled = (text: string) =>
  [...mount(text, { _tag: "End" }).view.contentDOM.querySelectorAll(".cm-line span")].map(
    (span) => [span.textContent, span.className],
  )

describe("text edits", () => {
  it("dispatches typing as EditText at the cursor", () => {
    const { view, commands } = mount("hello", { _tag: "End" })
    type(view, "!")
    assert.deepStrictEqual(commands, [{ _tag: "EditText", blockId, from: 5, to: 5, insert: "!" }])
    assert.strictEqual(view.state.doc.toString(), "hello!")
  })

  it("orders a multi-range change so each edit applies to the text the previous one left", () => {
    const { view, commands } = mount("a-b-c", { _tag: "Start" })
    view.dispatch({
      changes: [
        { from: 0, to: 1, insert: "AA" },
        { from: 4, to: 5, insert: "C" },
      ],
    })
    assert.deepStrictEqual(commands, [
      { _tag: "EditText", blockId, from: 4, to: 5, insert: "C" },
      { _tag: "EditText", blockId, from: 0, to: 1, insert: "AA" },
    ])
    assert.strictEqual(view.state.doc.toString(), "AA-b-C")
  })

  it("deletes a character with Backspace away from the block start", () => {
    const { view, commands } = mount("abc", { _tag: "Offset", offset: 2 })
    assert.isTrue(press(view, "Backspace"))
    assert.deepStrictEqual(commands, [{ _tag: "EditText", blockId, from: 1, to: 2, insert: "" }])
  })
})

describe("structural keys", () => {
  it("splits the block at the cursor on Enter", () => {
    const { view, commands } = mount("hello world", { _tag: "Offset", offset: 5 })
    assert.isTrue(press(view, "Enter"))
    assert.deepStrictEqual(commands, [{ _tag: "SplitBlock", blockId, at: 5 }])
  })

  it("deletes the selection before splitting on Enter", () => {
    const { view, commands } = mount("hello big world", { _tag: "Start" })
    view.dispatch({ selection: EditorSelection.single(5, 9) })
    press(view, "Enter")
    assert.deepStrictEqual(commands, [
      { _tag: "EditText", blockId, from: 5, to: 9, insert: "" },
      { _tag: "SplitBlock", blockId, at: 5 },
    ])
  })

  it("inserts a newline instead of splitting inside a fenced code block", () => {
    const { view, commands } = mount("```js\nlet x", { _tag: "End" })
    press(view, "Enter")
    assert.deepStrictEqual(commands, [
      { _tag: "EditText", blockId, from: 11, to: 11, insert: "\n" },
    ])
  })

  it("splits again once the cursor is past the closing fence", () => {
    const { view, commands } = mount("```\ncode\n```", { _tag: "End" })
    press(view, "Enter")
    assert.deepStrictEqual(commands, [{ _tag: "SplitBlock", blockId, at: 12 }])
  })

  it("inserts a soft line break on Shift-Enter", () => {
    const { view, commands } = mount("one", { _tag: "End" })
    press(view, "Enter", { shiftKey: true })
    assert.deepStrictEqual(commands, [{ _tag: "EditText", blockId, from: 3, to: 3, insert: "\n" }])
  })

  it("merges with the previous block on Backspace at the start", () => {
    const { view, commands } = mount("second", { _tag: "Start" })
    press(view, "Backspace")
    assert.deepStrictEqual(commands, [{ _tag: "MergeWithPrevious", blockId }])
    assert.strictEqual(view.state.doc.toString(), "second")
  })

  it("indents on Tab and outdents on Shift-Tab", () => {
    const { view, commands } = mount("child", { _tag: "End" })
    press(view, "Tab")
    press(view, "Tab", { shiftKey: true })
    assert.deepStrictEqual(commands, [
      { _tag: "Indent", blockIds: [blockId] },
      { _tag: "Outdent", blockIds: [blockId] },
    ])
  })

  it("sends undo and redo to the graph", () => {
    const { view, commands } = mount("text", { _tag: "End" })
    press(view, "z", { ctrlKey: true })
    press(view, "Z", { ctrlKey: true, shiftKey: true, keyCode: 90 })
    press(view, "y", { ctrlKey: true })
    assert.deepStrictEqual(commands, [{ _tag: "Undo" }, { _tag: "Redo" }, { _tag: "Redo" }])
  })
})

describe("moving between blocks", () => {
  it("leaves upward from the first line, keeping the column", () => {
    const { view, navigations } = mount("one\ntwo", { _tag: "Offset", offset: 2 })
    assert.isTrue(press(view, "ArrowUp"))
    assert.deepStrictEqual(navigations, [
      { _tag: "ToPrevious", cursor: { _tag: "LastLine", column: 2 } },
    ])
  })

  it("leaves downward from the last line, keeping the column", () => {
    const { view, navigations } = mount("one\ntwo", { _tag: "Offset", offset: 5 })
    press(view, "ArrowDown")
    assert.deepStrictEqual(navigations, [
      { _tag: "ToNext", cursor: { _tag: "FirstLine", column: 1 } },
    ])
  })

  it("stays inside the block when a line remains in that direction", () => {
    const { view, navigations } = mount("one\ntwo", { _tag: "Offset", offset: 5 })
    press(view, "ArrowUp")
    view.dispatch({ selection: { anchor: 1 } })
    press(view, "ArrowDown")
    assert.deepStrictEqual(navigations, [])
  })

  it("leaves left from the start and right from the end", () => {
    const start = mount("abc", { _tag: "Start" })
    press(start.view, "ArrowLeft")
    const end = mount("abc", { _tag: "End" })
    press(end.view, "ArrowRight")
    assert.deepStrictEqual(
      [...start.navigations, ...end.navigations],
      [
        { _tag: "ToPrevious", cursor: { _tag: "End" } },
        { _tag: "ToNext", cursor: { _tag: "Start" } },
      ],
    )
  })

  it("moves the caret normally in the middle of the text", () => {
    const { view, navigations } = mount("abc", { _tag: "Offset", offset: 1 })
    press(view, "ArrowLeft")
    assert.strictEqual(caret(view), 0)
    assert.deepStrictEqual(navigations, [])
  })

  it("places the caret where the previous block left off", () => {
    const placements: Array<[CursorPlacement, number]> = [
      [{ _tag: "Start" }, 0],
      [{ _tag: "End" }, 11],
      [{ _tag: "Offset", offset: 40 }, 11],
      [{ _tag: "FirstLine", column: 9 }, 5],
      [{ _tag: "LastLine", column: 2 }, 8],
    ]
    assert.deepStrictEqual(
      placements.map(([cursor]) => caret(mount("first\nlast!", cursor).view)),
      placements.map(([, expected]) => expected),
    )
  })
})

describe("text from the graph", () => {
  it("applies remote text without echoing it back and ignores echoes of its own edits", () =>
    Effect.gen(function* () {
      const incoming = yield* PubSub.unbounded<string>()
      const { view, commands } = mount("draft", { _tag: "End" }, Stream.fromPubSub(incoming))
      type(view, "s")
      type(view, "!")
      yield* PubSub.publish(incoming, "drafts")
      yield* Effect.yieldNow
      assert.strictEqual(view.state.doc.toString(), "drafts!")
      yield* PubSub.publish(incoming, "early drafts!")
      yield* Effect.yieldNow
      assert.strictEqual(view.state.doc.toString(), "early drafts!")
      assert.strictEqual(caret(view), 13)
      assert.deepStrictEqual(commands, [
        { _tag: "EditText", blockId, from: 5, to: 5, insert: "s" },
        { _tag: "EditText", blockId, from: 6, to: 6, insert: "!" },
      ])
    }).pipe(Effect.runPromise))
})

describe("autocomplete", () => {
  it("completes a page ref and reuses the auto-closed brackets", async () => {
    const { view, labels, searches, commands } = await complete("see [[proj]]", 10)
    assert.deepStrictEqual(labels, ["Project X", "Projects"])
    assert.deepStrictEqual(searches, ["page:proj"])
    assert.strictEqual(view.state.doc.toString(), "see [[Project X]]")
    assert.strictEqual(caret(view), 17)
    assert.deepStrictEqual(commands, [
      { _tag: "EditText", blockId, from: 6, to: 12, insert: "Project X]]" },
    ])
  })

  it("completes a block ref with the block id", async () => {
    const { view, labels, searches } = await complete("((ship", 6)
    assert.deepStrictEqual(labels, ["ship the editor"])
    assert.deepStrictEqual(searches, ["block:ship"])
    assert.strictEqual(view.state.doc.toString(), `((${otherBlockId}))`)
  })

  it("completes a tag, bracketing titles with spaces", async () => {
    const { view, searches } = await complete("todo #pro", 9)
    assert.deepStrictEqual(searches, ["page:pro"])
    assert.strictEqual(view.state.doc.toString(), "todo #[[Project X]]")
  })

  it("does not treat a hash inside a word as a tag", () => {
    const { view, searches } = mount("issue#4", { _tag: "End" })
    startCompletion(view)
    assert.deepStrictEqual(searches, [])
  })
})

describe("live markdown styling", () => {
  it("keeps markers visible and styles them apart from the content", () => {
    assert.deepStrictEqual(styled("**bold** and `code`"), [
      ["**", "sq-strong sq-mark"],
      ["bold", "sq-strong"],
      ["**", "sq-strong sq-mark"],
      ["`", "sq-mark"],
      ["code", "sq-code"],
      ["`", "sq-mark"],
    ])
  })

  it("styles page refs, block refs and tags", () => {
    assert.deepStrictEqual(styled("[[Page]] ((abc)) #tag #[[two words]] a#b"), [
      ["[[", "sq-page-ref sq-mark"],
      ["Page", "sq-page-ref"],
      ["]]", "sq-page-ref sq-mark"],
      ["((", "sq-block-ref sq-mark"],
      ["abc", "sq-block-ref"],
      ["))", "sq-block-ref sq-mark"],
      ["#", "sq-tag sq-mark"],
      ["tag", "sq-tag"],
      ["#[[", "sq-tag sq-mark"],
      ["two words", "sq-tag"],
      ["]]", "sq-tag sq-mark"],
    ])
  })

  it("leaves refs inside inline code unstyled as refs", () => {
    assert.deepStrictEqual(styled("`[[not a ref]]`"), [
      ["`", "sq-mark"],
      ["[[not a ref]]", "sq-code"],
      ["`", "sq-mark"],
    ])
  })
})
