import { EditorSelection } from "@codemirror/state"
import { afterEach, assert, describe, it } from "@effect/vitest"
import { Effect, PubSub, Stream } from "effect"
import type { Block } from "@seqno/domain"
import {
  blockId,
  blockOf,
  caret,
  keyOnWindow,
  mount,
  otherBlockId,
  parentBlockId,
  press,
  session,
  text,
  typeKeys,
  unmountAll,
} from "./mount.ts"

afterEach(unmountAll)

describe("text edits", () => {
  it("sends typing to the graph as EditText at the caret", () => {
    const { view, commands } = mount("hello", { _tag: "End" })
    typeKeys(view, "!")
    assert.deepStrictEqual(commands, [{ _tag: "EditText", blockId, from: 5, to: 5, insert: "!" }])
    assert.strictEqual(text(view), "hello!")
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
    assert.strictEqual(text(view), "AA-b-C")
  })

  it("deletes a character with Backspace away from the block start", () => {
    const { view, commands } = mount("abc", { _tag: "Offset", offset: 2 })
    assert.isTrue(press(view, "Backspace"))
    assert.deepStrictEqual(commands, [{ _tag: "EditText", blockId, from: 1, to: 2, insert: "" }])
  })
})

describe("structural keys", () => {
  it("splits the block at the caret on Enter", () => {
    const { view, commands } = mount("hello world", { _tag: "Offset", offset: 5 })
    assert.isTrue(press(view, "Enter"))
    assert.deepStrictEqual(commands, [{ _tag: "SplitBlock", blockId, at: 5 }])
  })

  it.effect("waits for the graph to have the block's text before splitting", () =>
    Effect.gen(function* () {
      const updates = yield* PubSub.unbounded<Block>()
      const { view, commands } = mount(
        "hello big world",
        { _tag: "Start" },
        { updates: Stream.fromPubSub(updates) },
      )
      view.dispatch({ selection: EditorSelection.single(5, 9) })
      press(view, "Enter")
      const before = [...commands]
      yield* PubSub.publish(updates, blockOf("hello world"))
      yield* Effect.yieldNow
      assert.deepStrictEqual(before, [{ _tag: "EditText", blockId, from: 5, to: 9, insert: "" }])
      assert.deepStrictEqual(commands.at(-1), { _tag: "SplitBlock", blockId, at: 5 })
    }),
  )

  it("inserts a newline instead of splitting inside a fenced code block", () => {
    const { view, commands } = mount("```js\nlet x", { _tag: "End" })
    press(view, "Enter")
    assert.deepStrictEqual(commands, [
      { _tag: "EditText", blockId, from: 11, to: 11, insert: "\n" },
    ])
  })

  it("splits again once the caret is past the closing fence", () => {
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
    assert.strictEqual(text(view), "second")
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

  it("asks the outliner to leave, fold and move the block", () => {
    const { view, actions } = mount("text", { _tag: "End" })
    press(view, "Escape")
    press(view, "ArrowUp", { ctrlKey: true })
    press(view, "ArrowDown", { ctrlKey: true })
    press(view, ";", { ctrlKey: true })
    press(view, "ArrowUp", { altKey: true, shiftKey: true })
    press(view, "ArrowDown", { altKey: true, shiftKey: true })
    assert.deepStrictEqual(actions, [
      { _tag: "Exit" },
      { _tag: "Collapse" },
      { _tag: "Expand" },
      { _tag: "ToggleCollapse" },
      { _tag: "MoveUp" },
      { _tag: "MoveDown" },
    ])
  })

  it("merges the next block in with Delete at the end", () => {
    const { view, actions } = mount("abc", { _tag: "Offset", offset: 1 })
    assert.isTrue(press(view, "Delete"))
    view.dispatch({ selection: { anchor: 2 } })
    press(view, "Delete")
    assert.deepStrictEqual([text(view), actions], ["ac", [{ _tag: "MergeNext" }]])
  })

  it("selects the block once Shift+arrow has nothing left to select in the text", () => {
    const { view, actions } = mount("one\ntwo", { _tag: "Offset", offset: 5 })
    press(view, "ArrowDown", { shiftKey: true })
    const inside = [...actions]
    view.dispatch({ selection: { anchor: 5, head: 7 } })
    press(view, "ArrowDown", { shiftKey: true })
    view.dispatch({ selection: { anchor: 2, head: 0 } })
    press(view, "ArrowUp", { shiftKey: true })
    assert.deepStrictEqual(inside, [])
    assert.deepStrictEqual(actions, [{ _tag: "SelectDown" }, { _tag: "SelectUp" }])
  })
})

const formatted = (
  initial: string,
  from: number,
  to: number,
  key: string,
  mods: KeyboardEventInit,
) => {
  const { view } = mount(initial, { _tag: "Start" })
  view.dispatch({ selection: EditorSelection.single(from, to) })
  press(view, key, mods)
  return [text(view), caret(view)]
}

describe("formatting shortcuts", () => {
  it("wraps the selection like Logseq and leaves the caret inside the closing mark", () => {
    assert.deepStrictEqual(formatted("hello", 0, 5, "b", { ctrlKey: true }), ["**hello**", 7])
    assert.deepStrictEqual(formatted("hello", 0, 5, "i", { ctrlKey: true }), ["*hello*", 6])
    assert.deepStrictEqual(formatted("hello", 0, 5, "h", { ctrlKey: true, shiftKey: true }), [
      "==hello==",
      7,
    ])
    assert.deepStrictEqual(formatted("hello", 0, 5, "s", { ctrlKey: true, shiftKey: true }), [
      "~~hello~~",
      7,
    ])
  })

  it("opens an empty pair at the caret without a selection", () => {
    assert.deepStrictEqual(formatted("x", 1, 1, "b", { ctrlKey: true }), ["x****", 3])
  })

  it("unwraps text that is already bold", () => {
    assert.deepStrictEqual(formatted("**hello**", 2, 7, "b", { ctrlKey: true }), ["hello", 5])
  })

  it("turns the selection into a link label, or opens an empty link", () => {
    assert.deepStrictEqual(formatted("hello", 0, 5, "l", { ctrlKey: true }), ["[hello]()", 8])
    assert.deepStrictEqual(formatted("x", 1, 1, "l", { ctrlKey: true }), ["x[]()", 2])
  })

  it("rotates the task marker on Mod-Enter", () => {
    const { view } = mount("water the beds", { _tag: "End" })
    const seen = [0, 1, 2, 3].map(() => {
      press(view, "Enter", { ctrlKey: true })
      return text(view)
    })
    assert.deepStrictEqual(seen, [
      "TODO water the beds",
      "DOING water the beds",
      "DONE water the beds",
      "water the beds",
    ])
    assert.strictEqual(caret(view), 14)
  })
})

describe("auto-pairs", () => {
  it("closes brackets, and steps over the closing one", () => {
    const { view } = mount("", { _tag: "End" })
    typeKeys(view, "x [")
    assert.deepStrictEqual([text(view), caret(view)], ["x []", 3])
    typeKeys(view, "]")
    assert.deepStrictEqual([text(view), caret(view)], ["x []", 4])
  })

  it("does not pair a parenthesis right after a word", () => {
    const { view } = mount("", { _tag: "End" })
    typeKeys(view, "a(")
    assert.strictEqual(text(view), "a(")
  })

  it("only wraps a selection with emphasis marks", () => {
    const { view } = mount("word", { _tag: "End" })
    typeKeys(view, " *")
    assert.strictEqual(text(view), "word *")
    view.dispatch({ selection: EditorSelection.single(0, 4) })
    typeKeys(view, "_")
    assert.strictEqual(text(view), "_word_ *")
  })

  it("deletes both halves of an empty pair with Backspace", () => {
    const { view } = mount("", { _tag: "End" })
    typeKeys(view, "x (")
    press(view, "Backspace")
    assert.strictEqual(text(view), "x ")
  })
})

describe("moving between blocks", () => {
  it("leaves upward from the first line and downward from the last", () => {
    const top = mount("one\ntwo", { _tag: "Offset", offset: 2 })
    press(top.view, "ArrowUp")
    const bottom = mount("one\ntwo", { _tag: "Offset", offset: 5 })
    press(bottom.view, "ArrowDown")
    assert.deepStrictEqual(
      [...top.actions, ...bottom.actions],
      [{ _tag: "FocusPrevious" }, { _tag: "FocusNext" }],
    )
  })

  it("hands the caret's horizontal position to the next editor", () => {
    const within = session()
    const { view } = mount("one\ntwo", { _tag: "Offset", offset: 5 }, { within })
    press(view, "ArrowDown")
    assert.deepStrictEqual(within.handoff.take(), {
      _tag: "Caret",
      cursor: { _tag: "FirstLine", x: 0 },
    })
  })

  it("stays inside the block while a line remains in that direction", () => {
    const { view, actions } = mount("one\ntwo", { _tag: "Offset", offset: 5 })
    press(view, "ArrowUp")
    view.dispatch({ selection: { anchor: 1 } })
    press(view, "ArrowDown")
    assert.deepStrictEqual(actions, [])
  })

  it("leaves left from the start and right from the end", () => {
    const start = mount("abc", { _tag: "Start" })
    press(start.view, "ArrowLeft")
    const end = mount("abc", { _tag: "End" })
    press(end.view, "ArrowRight")
    assert.deepStrictEqual(
      [...start.actions, ...end.actions],
      [{ _tag: "FocusPrevious" }, { _tag: "FocusNext" }],
    )
  })

  it("places the caret where it was asked to", () => {
    assert.deepStrictEqual(
      [
        mount("first\nlast!", { _tag: "Start" }),
        mount("first\nlast!", { _tag: "End" }),
        mount("first\nlast!", { _tag: "Offset", offset: 40 }),
        mount("first\nlast!", { _tag: "Offset", offset: 3 }),
      ].map(({ view }) => caret(view)),
      [0, 11, 11, 3],
    )
  })
})

describe("keys typed while the next block is on its way", () => {
  it("land in the new block once its editor mounts, not in the old one", () => {
    const within = session()
    const old = mount("first", { _tag: "End" }, { within })
    press(old.view, "Enter")
    const typed = ["n", "e", "w"].map((key) => keyOnWindow(key))
    const next = mount("", { _tag: "Start" }, { within, block: blockOf("", otherBlockId) })
    assert.deepStrictEqual(typed, [false, false, false])
    assert.strictEqual(text(old.view), "first")
    assert.deepStrictEqual([text(next.view), caret(next.view)], ["new", 3])
  })

  it.effect("keeps holding after a replayed Enter until the block after that mounts", () =>
    Effect.gen(function* () {
      const within = session()
      const updates = yield* PubSub.unbounded<Block>()
      const first = mount("one", { _tag: "End" }, { within })
      press(first.view, "Enter")
      for (const key of ["a", "Enter", "b"]) keyOnWindow(key)
      const second = mount(
        "",
        { _tag: "Start" },
        { within, updates: Stream.fromPubSub(updates), block: blockOf("", otherBlockId) },
      )
      const waited = within.commands.at(-1)
      yield* PubSub.publish(updates, blockOf("a", otherBlockId))
      yield* Effect.yieldNow
      const third = mount("", { _tag: "Start" }, { within, block: blockOf("", parentBlockId) })
      assert.deepStrictEqual([text(second.view), text(third.view)], ["a", "b"])
      assert.deepStrictEqual(waited, {
        _tag: "EditText",
        blockId: otherBlockId,
        from: 0,
        to: 0,
        insert: "a",
      })
      assert.deepStrictEqual(within.commands.at(-2), {
        _tag: "SplitBlock",
        blockId: otherBlockId,
        at: 1,
      })
    }),
  )

  it.effect("go back to the same block when Enter outdents it instead of splitting", () =>
    Effect.gen(function* () {
      const within = session()
      const updates = yield* PubSub.unbounded<Block>()
      const { view } = mount(
        "",
        { _tag: "Start" },
        { within, updates: Stream.fromPubSub(updates), block: blockOf("", blockId, parentBlockId) },
      )
      press(view, "Enter")
      keyOnWindow("x")
      assert.strictEqual(text(view), "")
      yield* PubSub.publish(updates, blockOf("", blockId, null))
      yield* Effect.yieldNow
      assert.strictEqual(text(view), "x")
    }),
  )

  it("lets go of the keys when the pointer goes elsewhere", () => {
    const within = session()
    const { view } = mount("one", { _tag: "End" }, { within })
    press(view, "Enter")
    window.dispatchEvent(new Event("pointerdown"))
    assert.isTrue(keyOnWindow("z"))
  })
})

describe("merging into the previous block", () => {
  it.effect("shows the merged text at once and keeps the caret at the seam", () =>
    Effect.gen(function* () {
      const within = session()
      const updates = yield* PubSub.unbounded<Block>()
      const second = mount(
        "tail",
        { _tag: "Start" },
        { within, block: blockOf("tail", otherBlockId) },
      )
      press(second.view, "Backspace")
      second.destroy()
      const first = mount(
        "head ",
        { _tag: "End" },
        { within, updates: Stream.fromPubSub(updates), block: blockOf("head ") },
      )
      assert.deepStrictEqual([text(first.view), caret(first.view)], ["head tail", 5])
      typeKeys(first.view, "+")
      yield* PubSub.publish(updates, blockOf("head "))
      yield* PubSub.publish(updates, blockOf("head tail"))
      yield* PubSub.publish(updates, blockOf("head +tail"))
      yield* Effect.yieldNow
      assert.deepStrictEqual([text(first.view), caret(first.view)], ["head +tail", 6])
      assert.deepStrictEqual(within.commands.at(-1), {
        _tag: "EditText",
        blockId,
        from: 5,
        to: 5,
        insert: "+",
      })
    }),
  )
})

describe("text from the graph", () => {
  it.effect("applies remote text without echoing it back and ignores echoes of its own edits", () =>
    Effect.gen(function* () {
      const updates = yield* PubSub.unbounded<Block>()
      const { view, commands } = mount(
        "draft",
        { _tag: "End" },
        { updates: Stream.fromPubSub(updates) },
      )
      typeKeys(view, "s!")
      yield* PubSub.publish(updates, blockOf("drafts"))
      yield* Effect.yieldNow
      assert.strictEqual(text(view), "drafts!")
      yield* PubSub.publish(updates, blockOf("early drafts!"))
      yield* Effect.yieldNow
      assert.deepStrictEqual([text(view), caret(view)], ["early drafts!", 13])
      assert.deepStrictEqual(commands, [
        { _tag: "EditText", blockId, from: 5, to: 5, insert: "s" },
        { _tag: "EditText", blockId, from: 6, to: 6, insert: "!" },
      ])
    }),
  )
})

describe("stale and undone text", () => {
  it.effect("keeps typed text when the graph repeats the text from before the typing", () =>
    Effect.gen(function* () {
      const updates = yield* PubSub.unbounded<Block>()
      const { view } = mount("draft", { _tag: "End" }, { updates: Stream.fromPubSub(updates) })
      typeKeys(view, "s")
      yield* PubSub.publish(updates, blockOf("draft"))
      yield* Effect.yieldNow
      assert.strictEqual(text(view), "drafts")
    }),
  )

  it.effect("takes the graph's text after undo, even when it is the text from before", () =>
    Effect.gen(function* () {
      const updates = yield* PubSub.unbounded<Block>()
      const { view } = mount("draft", { _tag: "End" }, { updates: Stream.fromPubSub(updates) })
      typeKeys(view, "s")
      press(view, "z", { ctrlKey: true })
      yield* PubSub.publish(updates, blockOf("draft"))
      yield* Effect.yieldNow
      assert.strictEqual(text(view), "draft")
    }),
  )
})

describe("headings", () => {
  it("keeps a heading block at its heading size while editing", () => {
    const { view } = mount("## Plan", { _tag: "End" })
    assert.isTrue(view.dom.classList.contains("sq-h2"))
    view.dispatch({ changes: { from: 0, to: 3 } })
    assert.isFalse(view.dom.classList.contains("sq-h2"))
  })
})
