import { RegistryProvider } from "@effect/atom-react"
import { expect, test } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { Block, BlockId } from "@seqno/domain"
import { coreRuntime, Outliner, type NavigationTarget } from "../src/index.ts"
import { block, fakeCore, id, pageId } from "./fake-core.ts"

const mount = async (blocks: ReadonlyArray<Block>, zoom: BlockId | null = null) => {
  const core = fakeCore(blocks)
  const navigations: Array<NavigationTarget> = []
  const screen = await render(
    <div style={{ height: "400px", width: "600px" }}>
      <RegistryProvider initialValues={[[coreRuntime.layer, core.layer]]}>
        <Outliner pageId={pageId} zoom={zoom} onNavigate={(target) => navigations.push(target)} />
      </RegistryProvider>
    </div>,
  )
  await expect.element(page.getByRole("tree")).toBeInTheDocument()
  return { core, navigations, screen }
}

const levels = () =>
  page
    .getByRole("treeitem")
    .elements()
    .map((row) => [row.getAttribute("aria-level"), row.textContent])

const editor = () => page.getByRole("textbox", { name: "Block text" })

const sample = [
  block(1, "Plan **launch** with `code` and [[Project]] #idea"),
  block(2, "child one", 1),
  block(3, "child two", 1),
  block(4, "Last [docs](https://example.com)"),
]

test("renders blocks as flat rows with their depth and static markdown", async () => {
  await mount(sample)
  expect(levels()).toEqual([
    ["1", "Plan launch with code and Project #idea"],
    ["2", "child one"],
    ["2", "child two"],
    ["1", "Last docs"],
  ])
  await expect.element(page.getByRole("strong")).toHaveTextContent("launch")
  await expect.element(page.getByRole("code")).toHaveTextContent("code")
  await expect
    .element(page.getByRole("link", { name: "docs" }))
    .toHaveAttribute("href", "https://example.com")
})

test("page refs and tags navigate to their page", async () => {
  const { navigations } = await mount(sample)
  await page.getByRole("link", { name: "[[Project]]" }).click()
  await page.getByRole("link", { name: "#idea" }).click()
  expect(navigations).toEqual([
    { _tag: "Page", name: "Project" },
    { _tag: "Page", name: "idea" },
  ])
})

test("collapsing a block hides its children", async () => {
  const { core } = await mount(sample)
  await page.getByRole("button", { name: "Collapse" }).click()
  await expect.element(page.getByRole("button", { name: "Expand" })).toBeInTheDocument()
  expect(levels()).toEqual([
    ["1", "Plan launch with code and Project #idea"],
    ["1", "Last docs"],
  ])
  expect(core.commands).toEqual([{ _tag: "SetCollapsed", blockId: id(1), collapsed: true }])
})

test("zooming shows breadcrumbs and only the zoomed subtree", async () => {
  const { navigations } = await mount([...sample, block(5, "grandchild", 2)], id(2))
  expect(
    page
      .getByRole("navigation", { name: "Breadcrumbs" })
      .getByRole("link")
      .elements()
      .map((link) => link.textContent),
  ).toEqual(["Inbox", "Plan **launch** with `code` and Project #idea", "child one"])
  expect(levels()).toEqual([
    ["1", "child one"],
    ["2", "grandchild"],
  ])
  await page.getByRole("button", { name: "Zoom into block" }).last().click()
  await page.getByRole("link", { name: "Inbox" }).click()
  expect(navigations).toEqual([
    { _tag: "Zoom", pageId, blockId: id(5) },
    { _tag: "Zoom", pageId, blockId: null },
  ])
})

test("typing in the focused block dispatches EditText", async () => {
  const { core } = await mount([block(1, "abc")])
  await page.getByText("abc").click()
  await expect.element(editor()).toHaveFocus()
  await userEvent.keyboard("d")
  await userEvent.keyboard("{Escape}")
  await expect.element(page.getByText("abcd")).toBeInTheDocument()
  expect(core.commands).toEqual([{ _tag: "EditText", blockId: id(1), from: 3, to: 3, insert: "d" }])
})

test("Enter splits the block and moves the editor to the new block", async () => {
  const { core } = await mount([block(1, "hello world")])
  await page.getByText("hello world").click()
  await userEvent.keyboard("{ArrowLeft>5}{Enter}")
  await expect.element(editor()).toHaveValue("world")
  await expect.element(editor()).toHaveFocus()
  expect(core.commands).toEqual([{ _tag: "SplitBlock", blockId: id(1), at: 6 }])
  expect(levels()).toEqual([
    ["1", "hello "],
    ["1", "world"],
  ])
})

test("Tab indents without losing the editor", async () => {
  const { core } = await mount([block(1, "first"), block(2, "second")])
  await page.getByText("second").click()
  await userEvent.keyboard("{Tab}")
  await expect.element(page.getByRole("treeitem").last()).toHaveAttribute("aria-level", "2")
  await expect.element(editor()).toHaveFocus()
  expect(core.commands).toEqual([{ _tag: "Indent", blockIds: [id(2)] }])
})

test("Backspace at the start merges with the previous block", async () => {
  const { core } = await mount([block(1, "first"), block(2, "second")])
  await page.getByText("second").click()
  await userEvent.keyboard("{Home}{Backspace}")
  await expect.element(editor()).toHaveValue("first")
  expect(core.commands).toEqual([{ _tag: "MergeWithPrevious", blockId: id(2) }])
})

test("arrow keys move the editor between blocks", async () => {
  await mount([block(1, "first"), block(2, "second"), block(3, "third")])
  await page.getByText("second").click()
  await userEvent.keyboard("{ArrowUp}")
  await expect.element(editor()).toHaveValue("first")
  await userEvent.keyboard("{ArrowDown}{ArrowDown}")
  await expect.element(editor()).toHaveValue("third")
})

test("block selection: extend with Shift, then indent and delete the selection", async () => {
  const { core } = await mount([block(1, "a"), block(2, "b"), block(3, "c"), block(4, "d")])
  await page.getByText("b").click()
  await userEvent.keyboard("{Escape}{Shift>}{ArrowDown}{/Shift}")
  expect(
    page
      .getByRole("treeitem", { selected: true })
      .elements()
      .map((row) => row.textContent),
  ).toEqual(["b", "c"])
  await userEvent.keyboard("{Tab}{Backspace}")
  expect(core.commands).toEqual([
    { _tag: "Indent", blockIds: [id(2), id(3)] },
    { _tag: "DeleteBlocks", blockIds: [id(2), id(3)] },
  ])
})

test("dragging a bullet onto the top half of a block moves it before that block", async () => {
  const { core } = await mount([block(1, "a"), block(2, "b"), block(3, "c")])
  const bullets = page.getByRole("button", { name: "Zoom into block" })
  await userEvent.dragAndDrop(bullets.nth(2), page.getByRole("treeitem").nth(1), {
    targetPosition: { x: 40, y: 2 },
  })
  await userEvent.dragAndDrop(bullets.nth(0), page.getByRole("treeitem").nth(1), {
    targetPosition: { x: 200, y: 26 },
  })
  expect(core.commands).toEqual([
    { _tag: "MoveBlocks", blockIds: [id(3)], parentId: null, after: id(1) },
    { _tag: "MoveBlocks", blockIds: [id(1)], parentId: id(2) },
  ])
})

test("block refs render the referenced block and navigate to it", async () => {
  const { navigations } = await mount([block(1, `see ((${id(2)}))`), block(2, "target **text**")])
  await expect.element(page.getByRole("treeitem").first()).toHaveTextContent("see target text")
  await page.getByRole("treeitem").first().getByRole("strong").click()
  expect(navigations).toEqual([{ _tag: "Zoom", pageId, blockId: id(2) }])
})

test("shift-clicking a ref or a bullet asks to open it in the right sidebar", async () => {
  const { navigations } = await mount([
    block(1, `[[Project]] and ((${id(2)}))`),
    block(2, "target"),
  ])
  await page.getByRole("link", { name: "[[Project]]" }).click({ modifiers: ["Shift"] })
  await page
    .getByRole("treeitem")
    .first()
    .getByText("target")
    .click({ modifiers: ["Shift"] })
  await page
    .getByRole("button", { name: "Zoom into block" })
    .last()
    .click({ modifiers: ["Shift"] })
  expect(navigations).toEqual([
    { _tag: "SidebarPage", name: "Project" },
    { _tag: "SidebarBlock", blockId: id(2) },
    { _tag: "SidebarBlock", blockId: id(2) },
  ])
})

test("only the rows near the viewport are in the DOM", async () => {
  await mount(Array.from({ length: 2000 }, (_, n) => block(n + 1, `row ${n + 1}`)))
  expect(page.getByRole("treeitem").elements().length).toBeLessThan(80)
  const outline = page.getByRole("tree").element()
  outline.scrollTop = outline.scrollHeight
  await expect.element(page.getByText("row 2000", { exact: true })).toBeInTheDocument()
  expect(page.getByText("row 1", { exact: true }).elements()).toEqual([])
})
