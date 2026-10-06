import { RegistryProvider } from "@effect/atom-react"
import { expect, test } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { Block, BlockId } from "@seqno/domain"
import { coreRuntime, Outliner, type NavigationTarget } from "../src/index.ts"
import { block, fakeCore, id, pageId } from "./fake-core.ts"
import { themeTokens } from "./theme.ts"

const mount = async (blocks: ReadonlyArray<Block>, zoom: BlockId | null = null) => {
  const core = fakeCore(blocks)
  const navigations: Array<NavigationTarget> = []
  const screen = await render(
    <div style={{ width: "600px" }}>
      <style>{themeTokens}</style>
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

const row = (text: string) => page.getByRole("treeitem").filter({ hasText: text }).first()

const editAtEnd = (text: string) => row(text).click({ position: { x: 560, y: 14 } })

const sample = [
  block(1, "Plan **launch** with `code` and [[Project]] #idea"),
  block(2, "child one", 1),
  block(3, "child two", 1),
  block(4, "Last [docs](https://example.com)"),
]

test("renders blocks as flat rows with their depth and Logseq markdown", async () => {
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
  await page.getByRole("link", { name: "Project", exact: true }).click()
  await page.getByRole("link", { name: "#idea" }).click()
  expect(navigations).toEqual([
    { _tag: "Page", name: "Project" },
    { _tag: "Page", name: "idea" },
  ])
})

test("the toggle arrow shows on hover and collapsing hides the children", async () => {
  const { core } = await mount(sample)
  await expect.element(page.getByRole("button", { name: "Collapse" })).not.toBeInTheDocument()
  await row("Plan").hover()
  await page.getByRole("button", { name: "Collapse" }).click()
  expect(levels()).toEqual([
    ["1", "Plan launch with code and Project #idea"],
    ["1", "Last docs"],
  ])
  expect(core.commands).toEqual([{ _tag: "SetCollapsed", blockId: id(1), collapsed: true }])
})

test("clicking a children guide collapses its parent", async () => {
  const { core } = await mount(sample)
  const guide = row("child one").element().querySelector(".seqno-guide")
  expect(guide).not.toBe(null)
  if (guide instanceof HTMLElement) await userEvent.click(guide)
  expect(core.commands).toEqual([{ _tag: "SetCollapsed", blockId: id(1), collapsed: true }])
})

test("zooming shows Logseq's breadcrumb and only the zoomed subtree", async () => {
  const { navigations } = await mount([...sample, block(5, "grandchild", 2)], id(5))
  expect(
    page
      .getByRole("navigation", { name: "Breadcrumbs" })
      .getByRole("link")
      .elements()
      .map((link) => link.textContent),
  ).toEqual(["Inbox", "Plan launch with code and Project #idea", "child one"])
  expect(levels()).toEqual([["1", "grandchild"]])
  await page.getByRole("link", { name: "child one" }).click()
  await page.getByRole("link", { name: "Inbox" }).click()
  await page.getByRole("button", { name: "Zoom into block" }).click()
  expect(navigations).toEqual([
    { _tag: "Zoom", pageId, blockId: id(2) },
    { _tag: "Zoom", pageId, blockId: null },
    { _tag: "Zoom", pageId, blockId: id(5) },
  ])
})

test("clicking text puts the caret where you clicked", async () => {
  const { core } = await mount([block(1, "abc")])
  await page.getByText("abc").click({ position: { x: 1, y: 8 } })
  await expect.element(editor()).toHaveFocus()
  await userEvent.keyboard("d")
  await userEvent.keyboard("{Escape}")
  await expect.element(page.getByText("dabc")).toBeInTheDocument()
  expect(core.commands).toEqual([{ _tag: "EditText", blockId: id(1), from: 0, to: 0, insert: "d" }])
})

test("clicking past the end of a line puts the caret at its end", async () => {
  const { core } = await mount([block(1, "abc")])
  await editAtEnd("abc")
  await userEvent.keyboard("d")
  expect(core.commands).toEqual([{ _tag: "EditText", blockId: id(1), from: 3, to: 3, insert: "d" }])
})

test("Enter splits the block and moves the editor to the new block", async () => {
  const { core } = await mount([block(1, "hello world")])
  await editAtEnd("hello world")
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
  await editAtEnd("second")
  await userEvent.keyboard("{Tab}")
  await expect.element(page.getByRole("treeitem").last()).toHaveAttribute("aria-level", "2")
  await expect.element(editor()).toHaveFocus()
  expect(core.commands).toEqual([{ _tag: "Indent", blockIds: [id(2)] }])
})

test("Backspace at the start merges with the previous block", async () => {
  const { core } = await mount([block(1, "first"), block(2, "second")])
  await editAtEnd("second")
  await userEvent.keyboard("{Home}{Backspace}")
  await expect.element(editor()).toHaveValue("first")
  expect(core.commands).toEqual([{ _tag: "MergeWithPrevious", blockId: id(2) }])
})

test("arrow keys move the editor between blocks", async () => {
  await mount([block(1, "first"), block(2, "second"), block(3, "third")])
  await editAtEnd("second")
  await userEvent.keyboard("{ArrowUp}")
  await expect.element(editor()).toHaveValue("first")
  await userEvent.keyboard("{ArrowDown}{ArrowDown}")
  await expect.element(editor()).toHaveValue("third")
})

const selectedTexts = () =>
  page
    .getByRole("treeitem", { selected: true })
    .elements()
    .map((selected) => selected.textContent)

test("block selection: Esc selects, Shift extends, then indent and delete the selection", async () => {
  const { core } = await mount([block(1, "a"), block(2, "b"), block(3, "c"), block(4, "d")])
  await editAtEnd("b")
  await userEvent.keyboard("{Escape}")
  expect(selectedTexts()).toEqual(["b"])
  await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}")
  expect(selectedTexts()).toEqual(["b", "c"])
  await userEvent.keyboard("{Tab}{Backspace}")
  expect(core.commands).toEqual([
    { _tag: "Indent", blockIds: [id(2), id(3)] },
    { _tag: "DeleteBlocks", blockIds: [id(2), id(3)] },
  ])
})

test("Shift-click extends the selection and Mod+Z / Mod+Shift+Z undo and redo", async () => {
  const { core } = await mount([block(1, "a"), block(2, "b"), block(3, "c")])
  await editAtEnd("a")
  await userEvent.keyboard("{Escape}")
  await page.getByText("c", { exact: true }).click({ modifiers: ["Shift"] })
  expect(selectedTexts()).toEqual(["a", "b", "c"])
  await userEvent.keyboard("{Control>}z{/Control}{Control>}{Shift>}z{/Shift}{/Control}")
  expect(core.commands).toEqual([{ _tag: "Undo" }, { _tag: "Redo" }])
})

test("a selected parent highlights its whole subtree", async () => {
  await mount(sample)
  await editAtEnd("Plan")
  await userEvent.keyboard("{Escape}")
  const boxes = page.getByRole("tree").element().querySelectorAll(".seqno-selection")
  expect([...boxes].map((box) => box.getAttribute("data-edge"))).toEqual([
    "first",
    "middle",
    "last",
  ])
})

test("dragging a bullet onto the top half of a block moves it before that block", async () => {
  const { core } = await mount([block(1, "a"), block(2, "b"), block(3, "c")])
  const bullets = page.getByRole("button", { name: "Zoom into block" })
  await userEvent.dragAndDrop(bullets.nth(2), page.getByRole("treeitem").nth(1), {
    targetPosition: { x: 40, y: 2 },
  })
  await userEvent.dragAndDrop(bullets.nth(0), page.getByRole("treeitem").nth(1), {
    targetPosition: { x: 200, y: 24 },
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
  await page.getByRole("link", { name: "Project" }).click({ modifiers: ["Shift"] })
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

test("task markers get a checkbox, and checking it marks the task DONE", async () => {
  const { core } = await mount([
    block(1, "TODO Order panels"),
    block(2, "DONE Pour footings"),
    block(3, "CANCELED Rain barrel"),
    block(4, "WAITING Brackets"),
  ])
  expect(levels().map(([, text]) => text)).toEqual([
    "TODOOrder panels",
    "Pour footings",
    "Rain barrel",
    "WAITINGBrackets",
  ])
  await expect.element(page.getByRole("checkbox", { name: "Mark as not done" })).toBeChecked()
  expect(page.getByRole("checkbox").elements()).toHaveLength(3)
  await page.getByRole("link", { name: "TODO" }).click()
  await expect.element(page.getByRole("link", { name: "DOING" })).toBeInTheDocument()
  await page.getByRole("checkbox", { name: "Mark as done" }).first().click()
  expect(core.commands).toEqual([
    { _tag: "EditText", blockId: id(1), from: 0, to: 4, insert: "DOING" },
    { _tag: "EditText", blockId: id(1), from: 0, to: 5, insert: "DONE" },
  ])
})

test("Mod+Enter on a selection cycles its task markers", async () => {
  const { core } = await mount([block(1, "Paint"), block(2, "TODO Sand")])
  await editAtEnd("Paint")
  await userEvent.keyboard("{Escape}{Shift>}{ArrowDown}{/Shift}{Control>}{Enter}{/Control}")
  expect(core.commands).toEqual([
    { _tag: "EditText", blockId: id(1), from: 0, to: 0, insert: "TODO " },
    { _tag: "EditText", blockId: id(2), from: 0, to: 4, insert: "DOING" },
  ])
})

test("properties render as key and value rows, without id and collapsed", async () => {
  await mount([
    block(
      1,
      `Tomato bed\nid:: ${id(9)}\nvariety:: San Marzano\nlocation:: [[Greenhouse]]\ncollapsed:: true`,
    ),
  ])
  expect(levels()).toEqual([["1", "Tomato bedvariety:San Marzanolocation:Greenhouse"]])
  await expect.element(page.getByRole("link", { name: "Greenhouse" })).toBeInTheDocument()
})

test("SCHEDULED, the logbook total and its drawer", async () => {
  await mount([
    block(
      1,
      "TODO Check the frost cloth\nSCHEDULED: <2026-10-08 Thu .+1w>\n:LOGBOOK:\nCLOCK: [2026-10-04 Sun 09:12:30]--[2026-10-04 Sun 10:47:05] =>  01:34:35\n:END:",
    ),
  ])
  await expect.element(page.getByText("<2026-10-08 Thu .+1w>")).toBeInTheDocument()
  await page.getByRole("link", { name: "1h34m" }).click()
  await expect.element(page.getByText(":LOGBOOK:")).toBeInTheDocument()
})

test("numbered blocks show their position instead of a dot", async () => {
  await mount([
    block(1, "Steps"),
    block(2, "Fill\nlogseq.order-list-type:: number", 1),
    block(3, "Press\nlogseq.order-list-type:: number", 1),
    block(4, "Cover\nlogseq.order-list-type:: number", 1),
  ])
  expect(
    page
      .getByRole("button", { name: "Zoom into block" })
      .elements()
      .map((bullet) => bullet.textContent),
  ).toEqual(["", "1.", "2.", "3."])
})

test("code blocks render highlighted lines with line numbers", async () => {
  await mount([block(1, "```ts\nconst ripe = 1\nripe\n```")])
  const code = page.getByRole("tree").element().querySelector(".seqno-codeblock")
  expect(code?.querySelector(".seqno-code-gutter")?.textContent).toBe("12")
  expect(
    [...(code?.querySelectorAll("[class^=seqno-tok-]") ?? [])].map((token) => [
      token.className,
      token.textContent,
    ]),
  ).toEqual([
    ["seqno-tok-keyword", "const"],
    ["seqno-tok-def", "ripe"],
    ["seqno-tok-operator", "="],
    ["seqno-tok-number", "1"],
    ["seqno-tok-variable", "ripe"],
  ])
})

test("only rows near the viewport are mounted while the document scrolls", async () => {
  await mount(Array.from({ length: 3000 }, (_, n) => block(n + 1, `row ${n + 1}`)))
  expect(page.getByRole("treeitem").elements().length).toBeLessThan(120)
  window.scrollTo(0, document.documentElement.scrollHeight)
  await expect.element(page.getByText("row 3000", { exact: true })).toBeInTheDocument()
  expect(page.getByText("row 1", { exact: true }).elements()).toEqual([])
  expect(page.getByRole("treeitem").elements().length).toBeLessThan(120)
  window.scrollTo(0, 0)
  await expect.element(page.getByText("row 1", { exact: true })).toBeInTheDocument()
})
