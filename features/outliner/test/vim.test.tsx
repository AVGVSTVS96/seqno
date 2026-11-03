import { RegistryProvider } from "@effect/atom-react"
import { expect, test } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { Block } from "@seqno/domain"
import { coreLayer, Outliner } from "../src/index.ts"
import { block, fakeCore, id, pageId } from "./fake-core.ts"
import { themeTokens } from "./theme.ts"

const mount = async (blocks: ReadonlyArray<Block>, vim = true) => {
  const core = fakeCore(blocks)
  await render(
    <div style={{ width: "600px" }}>
      <style>{themeTokens}</style>
      <RegistryProvider initialValues={[[coreLayer, core.layer]]}>
        <Outliner pageId={pageId} zoom={null} onNavigate={() => undefined} vim={vim} />
      </RegistryProvider>
    </div>,
  )
  await expect.element(page.getByRole("tree")).toBeInTheDocument()
  return core
}

const selectedTexts = () =>
  page
    .getByRole("treeitem", { selected: true })
    .elements()
    .map((selected) => selected.textContent)

const focusTree = () => {
  const tree = page.getByRole("tree").element()
  if (tree instanceof HTMLElement) tree.focus()
}

const selectFirst = async () => {
  focusTree()
  await userEvent.keyboard("j")
}

const four = [block(1, "a"), block(2, "b"), block(3, "c"), block(4, "d")]

test("j and k move the selection, with counts, and gg and G jump to the first and last block", async () => {
  await mount(four)
  await selectFirst()
  expect(selectedTexts()).toEqual(["a"])
  await userEvent.keyboard("j")
  expect(selectedTexts()).toEqual(["b"])
  await userEvent.keyboard("2j")
  expect(selectedTexts()).toEqual(["d"])
  await userEvent.keyboard("k")
  expect(selectedTexts()).toEqual(["c"])
  await userEvent.keyboard("gg")
  expect(selectedTexts()).toEqual(["a"])
  await userEvent.keyboard("G")
  expect(selectedTexts()).toEqual(["d"])
})

test("dd deletes the block and selects the next one, and p pastes what dd took", async () => {
  const core = await mount(four)
  await selectFirst()
  await userEvent.keyboard("jdd")
  expect(selectedTexts()).toEqual(["c"])
  await userEvent.keyboard("p")
  expect(core.commands).toEqual([
    { _tag: "DeleteBlocks", blockIds: [id(2)] },
    {
      _tag: "InsertBlocks",
      pageId,
      parentId: null,
      after: id(3),
      blocks: [{ text: "b", props: {}, children: [] }],
    },
  ])
})

test("yy copies without deleting and P pastes above", async () => {
  const core = await mount(four)
  await selectFirst()
  await userEvent.keyboard("yyjjP")
  expect(core.commands).toEqual([
    {
      _tag: "InsertBlocks",
      pageId,
      parentId: null,
      after: id(2),
      blocks: [{ text: "a", props: {}, children: [] }],
    },
  ])
})

test(">> and << indent and outdent, zc zo and za fold the children", async () => {
  const core = await mount([block(1, "a"), block(2, "b", 1), block(3, "c")])
  const child = page.getByText("b", { exact: true })
  await selectFirst()
  await userEvent.keyboard("G>><<gg")
  await userEvent.keyboard("zc")
  await expect.element(child).not.toBeInTheDocument()
  await userEvent.keyboard("zo")
  await expect.element(child).toBeInTheDocument()
  await userEvent.keyboard("za")
  await expect.element(child).not.toBeInTheDocument()
  expect(core.commands).toEqual([
    { _tag: "Indent", blockIds: [id(3)] },
    { _tag: "Outdent", blockIds: [id(3)] },
    { _tag: "SetCollapsed", blockId: id(1), collapsed: true },
    { _tag: "SetCollapsed", blockId: id(1), collapsed: false },
    { _tag: "SetCollapsed", blockId: id(1), collapsed: true },
  ])
})

test("V then j selects whole blocks and d deletes them all", async () => {
  const core = await mount(four)
  await selectFirst()
  await userEvent.keyboard("jVj")
  expect(selectedTexts()).toEqual(["b", "c"])
  await userEvent.keyboard("d")
  expect(core.commands).toEqual([{ _tag: "DeleteBlocks", blockIds: [id(2), id(3)] }])
  expect(selectedTexts()).toEqual(["d"])
})

test("Escape in visual mode drops back to the one block under the cursor", async () => {
  await mount(four)
  await selectFirst()
  await userEvent.keyboard("Vjj{Escape}")
  expect(selectedTexts()).toEqual(["c"])
  await userEvent.keyboard("j")
  expect(selectedTexts()).toEqual(["d"])
})

test("o opens an empty block below", async () => {
  const core = await mount(four)
  await selectFirst()
  await userEvent.keyboard("o")
  expect(core.commands).toEqual([
    { _tag: "InsertBlock", pageId, parentId: null, after: id(1), text: "" },
  ])
})

test("a edits the selected block", async () => {
  await mount(four)
  await selectFirst()
  await userEvent.keyboard("a")
  await expect.element(page.getByRole("textbox", { name: "Block text" })).toHaveValue("a")
})

test("u and Ctrl-r undo and redo", async () => {
  const core = await mount(four)
  await selectFirst()
  await userEvent.keyboard("u{Control>}r{/Control}")
  expect(core.commands).toEqual([{ _tag: "Undo" }, { _tag: "Redo" }])
})

test("with vim mode off the letter keys do nothing to the selection", async () => {
  const core = await mount(four, false)
  focusTree()
  await userEvent.keyboard("{ArrowDown}jdd")
  expect(selectedTexts()).toEqual(["a"])
  expect(core.commands).toEqual([])
})
