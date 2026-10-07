import { afterEach, assert, describe, it, vi } from "@effect/vitest"
import type { MountedEditor } from "@seqno/editor"
import { submitDate } from "../src/planning.ts"
import { blockId, caret, mount, otherBlockId, press, text, typeKeys, unmountAll } from "./mount.ts"

afterEach(unmountAll)

const popupOf = (popups: MountedEditor["popups"]) => popups.frame()?.popup ?? null

const labels = (popups: MountedEditor["popups"]) =>
  popupOf(popups)?.choices.map((choice) => {
    switch (choice._tag) {
      case "Command":
        return choice.command.label
      case "Block":
        return choice.text
      case "NewPage":
        return `New page ${choice.title}`
      case "Journal":
        return choice.label
      case "Page":
        return choice.title
    }
  }) ?? null

const relativeDates = [
  "Today",
  "Tomorrow",
  "Yesterday",
  "Next week",
  "This week",
  "Last week",
  "Next month",
  "This month",
  "Last month",
  "Next year",
]

const active = (popups: MountedEditor["popups"]) => popupOf(popups)?.active ?? null

describe("slash menu", () => {
  it("opens after a space with Logseq's groups in Logseq's order", () => {
    const { view, popups } = mount("", { _tag: "End" })
    typeKeys(view, "x /")
    const groups = popupOf(popups)?.choices.flatMap((choice) =>
      choice._tag === "Command" ? [choice.command.group] : [],
    )
    assert.deepStrictEqual(
      [...new Set(groups)],
      [
        "BASIC",
        "FORMAT",
        "Heading",
        "TASK STATUS",
        "TASK DATE",
        "PRIORITY",
        "TIME & DATE",
        "LIST TYPE",
        "ADVANCED",
      ],
    )
    assert.deepStrictEqual(labels(popups)?.slice(0, 6), [
      "Page reference",
      "Page embed",
      "Block reference",
      "Block embed",
      "Link",
      "Image link",
    ])
  })

  it("filters by prefix first, then inside words, then scattered letters", () => {
    const { view, popups } = mount("", { _tag: "End" })
    typeKeys(view, "/to")
    assert.deepStrictEqual(labels(popups), [
      "TODO",
      "Today",
      "Tomorrow",
      "Calculator",
      "Math block",
      "Query function",
    ])
  })

  it("moves the choice with the arrows, wrapping at both ends", () => {
    const { view, popups, actions } = mount("", { _tag: "End" })
    typeKeys(view, "/to")
    press(view, "ArrowDown")
    press(view, "ArrowDown")
    const moved = active(popups)
    press(view, "ArrowUp")
    press(view, "ArrowUp")
    press(view, "ArrowUp")
    assert.deepStrictEqual([moved, active(popups)], [2, 5])
    press(view, "n", { ctrlKey: true })
    assert.strictEqual(active(popups), 0)
    assert.deepStrictEqual(actions, [])
  })

  it("runs the chosen command in place of the slash text", () => {
    const { view, popups, commands } = mount("water", { _tag: "End" })
    typeKeys(view, " /to")
    press(view, "Enter")
    assert.deepStrictEqual([text(view), caret(view), popupOf(popups)], ["TODO water ", 11, null])
    assert.deepStrictEqual(commands.slice(-2), [
      { _tag: "EditText", blockId, from: 6, to: 9, insert: "" },
      { _tag: "EditText", blockId, from: 0, to: 0, insert: "TODO " },
    ])
  })

  it("follows a page reference with the page search", () => {
    const { view, popups } = mount("", { _tag: "End" })
    typeKeys(view, "/page ref")
    press(view, "Enter")
    assert.deepStrictEqual([text(view), caret(view)], ["[[]]", 2])
    assert.deepStrictEqual(labels(popups), relativeDates)
  })

  it("opens the date picker for Scheduled, and warns instead on an empty block", () => {
    const { view, popups } = mount("water the beds", { _tag: "End" })
    typeKeys(view, " /scheduled")
    press(view, "Enter")
    assert.deepStrictEqual(
      [text(view), popups.picker()?.kind ?? null, popupOf(popups)],
      ["water the beds ", "SCHEDULED", null],
    )
    submitDate(view, "SCHEDULED", {
      date: new Date(2026, 9, 8),
      time: "09:30",
      repeater: { count: 1, unit: "w" },
    })
    assert.deepStrictEqual(
      [text(view), popups.picker()],
      ["water the beds\nSCHEDULED: <2026-10-08 Thu 09:30 .+1w>", null],
    )
    const empty = mount("", { _tag: "End" })
    typeKeys(empty.view, "/deadline")
    press(empty.view, "Enter")
    assert.deepStrictEqual(
      [text(empty.view), empty.popups.picker(), empty.actions],
      ["", null, [{ _tag: "Notify", message: "Please add some content first." }]],
    )
  })

  it("closes when nothing matches, and ignores a slash inside a word", () => {
    const missing = mount("", { _tag: "End" })
    typeKeys(missing.view, "/zzq")
    const inside = mount("", { _tag: "End" })
    typeKeys(inside.view, "and/or")
    assert.deepStrictEqual([popupOf(missing.popups), popupOf(inside.popups)], [null, null])
  })
})

describe("page search", () => {
  it("offers today's journals for an empty [[", () => {
    const { view, popups } = mount("", { _tag: "End" })
    typeKeys(view, "[[")
    assert.deepStrictEqual([text(view), labels(popups)], ["[[]]", relativeDates])
  })

  it("ranks pages and offers a new page right after a close match", async () => {
    const { view, popups, searches } = mount("see ", { _tag: "End" })
    typeKeys(view, "[[proj")
    await vi.waitFor(() =>
      assert.deepStrictEqual(labels(popups), ["Projects", "New page proj", "Project X"]),
    )
    assert.deepStrictEqual(searches.at(-1), "page:proj")
    press(view, "Enter")
    assert.deepStrictEqual(
      [text(view), caret(view), popupOf(popups)],
      ["see [[Projects]]", 16, null],
    )
  })

  it("puts the new page first when no page starts with the text, and drops it on an exact match", async () => {
    const plan = mount("", { _tag: "End" })
    typeKeys(plan.view, "[[plan")
    const exact = mount("", { _tag: "End" })
    typeKeys(exact.view, "[[projects")
    await vi.waitFor(() =>
      assert.deepStrictEqual(
        [labels(plan.popups), labels(exact.popups)],
        [["New page plan", "Garden Plan"], ["Projects"]],
      ),
    )
  })

  it("lists a tag-only page first for #, and leaves out pages matched only by scattered letters", async () => {
    const { view, popups, pages } = mount("", { _tag: "End" })
    pages.push({ name: "projects/greenhouse", title: "projects/Greenhouse" })
    pages.push({ name: "greenhouse", title: "greenhouse" })
    typeKeys(view, "#gre")
    await vi.waitFor(() =>
      assert.deepStrictEqual(labels(popups), ["greenhouse", "New page gre", "projects/Greenhouse"]),
    )
  })

  it("opens the chosen page in the sidebar on Shift+Enter and keeps the popup", async () => {
    const { view, popups, actions } = mount("see ", { _tag: "End" })
    typeKeys(view, "[[proj")
    await vi.waitFor(() => assert.strictEqual(labels(popups)?.[0], "Projects"))
    press(view, "Enter", { shiftKey: true })
    assert.deepStrictEqual(
      [actions, text(view), labels(popups)],
      [
        [{ _tag: "Open", target: { _tag: "Page", name: "Projects" }, sidebar: true }],
        "see [[proj]]",
        ["Projects", "New page proj", "Project X"],
      ],
    )
  })

  it("brackets a tag with spaces", async () => {
    const { view, popups } = mount("todo ", { _tag: "End" })
    typeKeys(view, "#pro")
    await vi.waitFor(() => assert.strictEqual(labels(popups)?.[2], "Project X"))
    press(view, "ArrowUp")
    press(view, "Enter")
    assert.strictEqual(text(view), "todo #[[Project X]]")
  })

  it("does not treat a hash inside a word as a tag", () => {
    const { view, popups } = mount("issue", { _tag: "End" })
    typeKeys(view, "#4")
    assert.strictEqual(popupOf(popups), null)
  })
})

describe("block search", () => {
  it("inserts the chosen block's id", async () => {
    const { view, popups } = mount("", { _tag: "End" })
    typeKeys(view, "((ship")
    await vi.waitFor(() => assert.deepStrictEqual(labels(popups), ["ship the editor"]))
    press(view, "Enter")
    assert.deepStrictEqual([text(view), caret(view)], [`((${otherBlockId}))`, 40])
  })
})
