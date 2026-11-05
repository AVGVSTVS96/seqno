import { afterEach, assert, describe, it } from "@effect/vitest"
import type { EditorView } from "@codemirror/view"
import type { CursorPlacement } from "@seqno/editor"
import { blockId, caret, mount, session, text, typeKeys, unmountAll } from "./mount.ts"

afterEach(unmountAll)

const keyDown = (view: EditorView, init: KeyboardEventInit) => {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }),
  )
}

const keys = (view: EditorView, ...pressed: readonly string[]) => {
  for (const key of pressed) {
    keyDown(view, { key })
  }
}

const end: CursorPlacement = { _tag: "End" }

const vimOn = (value: string, cursor: CursorPlacement = end, within = session()) =>
  mount(value, cursor, { vim: true, within })

describe("vim mode in the block editor", () => {
  it("opens in insert mode, so typing writes text", () => {
    const { view, commands } = vimOn("hello")
    typeKeys(view, "!")
    assert.strictEqual(text(view), "hello!")
    assert.deepStrictEqual(commands, [{ _tag: "EditText", blockId, from: 5, to: 5, insert: "!" }])
  })

  it("leaves insert mode on Escape and edits with normal-mode commands", () => {
    const { view, commands } = vimOn("one two three", { _tag: "Start" })
    keys(view, "Escape", "w", "d", "w")
    assert.strictEqual(text(view), "one three")
    assert.deepStrictEqual(commands, [{ _tag: "EditText", blockId, from: 4, to: 8, insert: "" }])
  })

  it("selects the block on Escape from normal mode", () => {
    const { view, actions } = vimOn("hello")
    keys(view, "Escape")
    assert.deepStrictEqual(actions, [])
    keys(view, "Escape")
    assert.deepStrictEqual(actions, [{ _tag: "Exit" }])
  })

  it("deletes a word in visual mode", () => {
    const { view } = vimOn("alpha beta", { _tag: "Start" })
    keys(view, "Escape", "v", "e", "d")
    assert.strictEqual(text(view), " beta")
  })

  it("moves to the next block on j from the last line, carrying normal mode and the column", () => {
    const within = session()
    const { view, actions } = vimOn("first\nsecond", { _tag: "Start" }, within)
    keys(view, "Escape", "j")
    assert.deepStrictEqual(actions, [])
    keys(view, "l", "l", "j")
    assert.deepStrictEqual(actions, [{ _tag: "FocusNext" }])
    const next = vimOn("another block", { _tag: "Start" }, within)
    assert.strictEqual(caret(next.view), 2)
    keys(next.view, "x")
    assert.strictEqual(text(next.view), "anther block")
  })

  it("moves to the previous block on k from the first line", () => {
    const { view, actions } = vimOn("only line")
    keys(view, "Escape", "k")
    assert.deepStrictEqual(actions, [{ _tag: "FocusPrevious" }])
  })

  it("arrives in insert mode when the move came from somewhere else", () => {
    const within = session()
    vimOn("first", { _tag: "End" }, within)
    const next = vimOn("second", { _tag: "Start" }, within)
    typeKeys(next.view, "x")
    assert.strictEqual(text(next.view), "xsecond")
  })

  it("opens a new block below on o, holding what is typed next for it", () => {
    const { view, actions } = vimOn("one")
    keys(view, "Escape", "o", "x")
    assert.deepStrictEqual(actions, [{ _tag: "NewBlock", below: true }])
    assert.strictEqual(text(view), "one")
  })

  it("opens a new block above on O", () => {
    const { view, actions } = vimOn("two")
    keys(view, "Escape", "O")
    assert.deepStrictEqual(actions, [{ _tag: "NewBlock", below: false }])
  })

  it("opens a line inside the block on o when the caret isn't on its last line", () => {
    const { view, actions } = vimOn("one\ntwo", { _tag: "Start" })
    keys(view, "Escape", "o")
    assert.deepStrictEqual(actions, [])
    assert.strictEqual(text(view), "one\n\ntwo")
  })

  it("sends u and Ctrl-r to the graph's undo history", () => {
    const { view, commands } = vimOn("hello")
    keys(view, "Escape", "u")
    keyDown(view, { key: "r", ctrlKey: true })
    assert.deepStrictEqual(commands, [{ _tag: "Undo" }, { _tag: "Redo" }])
  })

  it("keeps Enter and Backspace as vim motions in normal mode", () => {
    const { view, commands } = vimOn("hello", { _tag: "Start" })
    keys(view, "Escape", "Backspace", "Enter")
    assert.deepStrictEqual(commands, [])
    assert.strictEqual(text(view), "hello")
  })

  it("still splits the block on Enter in insert mode", () => {
    const { view, commands } = vimOn("hello world", { _tag: "Offset", offset: 5 })
    keys(view, "Enter")
    assert.deepStrictEqual(commands, [{ _tag: "SplitBlock", blockId, at: 5 }])
  })
})
