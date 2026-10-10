import { EditorView } from "@codemirror/view"
import { afterEach, assert, describe, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BlockEditor, createHandoff } from "@seqno/editor"
import { blockOf, page, typeKeys } from "./mount.ts"

const roots: Array<Root> = []

afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount())
  document.body.replaceChildren()
})

const render = async (text: string) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)
  const draw = () =>
    root.render(
      createElement(BlockEditor, {
        block: blockOf(text),
        cursor: { _tag: "End" },
        updates: Stream.never,
        handoff: createHandoff(),
        host: {
          dispatch: () => undefined,
          dispatchAll: () => undefined,
          act: () => undefined,
          searchPages: () => Effect.succeed([page("Garden Plan")]),
          searchBlocks: () => Effect.succeed([]),
        },
      }),
    )
  await act(draw)
  await act(draw)
  const dom = container.querySelector(".cm-editor")
  const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
  if (view === null) throw new Error("no editor mounted")
  return { container, root, view }
}

const options = () =>
  [...document.querySelectorAll("[role=listbox] [role=option]")].map((option) => [
    option.textContent,
    option.getAttribute("aria-selected"),
  ])

describe("BlockEditor", () => {
  it("mounts one focused editor on the block and removes it on unmount", async () => {
    const { container, root } = await render("edit **me**")
    const content = container.querySelector(".cm-content")
    assert.strictEqual(container.querySelectorAll(".cm-editor").length, 1)
    assert.strictEqual(content?.textContent, "edit **me**")
    assert.strictEqual(document.activeElement, content)
    assert.deepStrictEqual(
      ["spellcheck", "autocorrect", "autocapitalize"].map((name) => content?.getAttribute(name)),
      ["true", "on", "sentences"],
    )
    await act(() => root.unmount())
    roots.splice(0)
    assert.strictEqual(container.innerHTML, "")
  })

  it("draws the slash menu as a listbox with Logseq's group headings", async () => {
    const { view } = await render("")
    await act(() => typeKeys(view, "/"))
    const listbox = document.querySelector("[role=listbox]")
    const groups = [...document.querySelectorAll("[role=listbox] [role=group]")]
    assert.strictEqual(listbox?.getAttribute("aria-label"), "Commands")
    assert.deepStrictEqual(
      groups.slice(0, 3).map((group) => group.firstElementChild?.textContent),
      ["BASIC", "FORMAT", "Heading"],
    )
    assert.deepStrictEqual(options().slice(0, 2), [
      ["Page reference", "true"],
      ["Page embed", "false"],
    ])
  })

  it("marks the matched letters and follows the pointer", async () => {
    const { view } = await render("")
    await act(() => typeKeys(view, "[[gar"))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    assert.deepStrictEqual(options(), [
      ["Garden Plan", "true"],
      ["New page gar", "false"],
    ])
    assert.deepStrictEqual(
      [...document.querySelectorAll("[role=option] mark")].map((mark) => mark.textContent),
      ["Gar"],
    )
    const second = document.querySelectorAll("[role=option]")[1]
    await act(() =>
      second?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 5 })),
    )
    assert.deepStrictEqual(options()[1], ["New page gar", "true"])
    await act(() => second?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    assert.deepStrictEqual([view.state.doc.toString(), options()], ["[[gar]]", []])
  })
})
