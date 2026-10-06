import { assert, describe, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { BlockId, type Command } from "@seqno/domain"
import { BlockEditor } from "@seqno/editor"

const blockId = BlockId.make("01920000-0000-7000-8000-000000000001")

describe("BlockEditor", () => {
  it("mounts a focused editor on the block and removes it on unmount", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    const commands: Array<Command> = []
    const render = () =>
      root.render(
        createElement(BlockEditor, {
          blockId,
          text: "edit **me**",
          cursor: { _tag: "End" },
          textUpdates: Stream.never,
          host: {
            dispatch: (command) => commands.push(command),
            navigate: () => undefined,
            searchPages: () => Effect.succeed([]),
            searchBlocks: () => Effect.succeed([]),
          },
        }),
      )
    await act(render)
    await act(render)
    const editors = container.querySelectorAll(".cm-editor")
    const content = container.querySelector(".cm-content")
    assert.strictEqual(editors.length, 1)
    assert.strictEqual(content?.textContent, "edit **me**")
    assert.strictEqual(document.activeElement, content)
    await act(() => root.unmount())
    assert.strictEqual(container.innerHTML, "")
  })
})
