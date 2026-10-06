import { describe, expect, it } from "@effect/vitest"
import {
  idle,
  keysOf,
  nextKeyState,
  type KeyPress,
  type ShortcutAction,
} from "../src/ui/shell/shortcuts.ts"
import { leftWidthAt, remember, rightWidthAt, rightWidthStep } from "../src/ui/shell/state.ts"

const press = (key: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
})

const actionsOf = (presses: ReadonlyArray<KeyPress>) =>
  presses.reduce<{ state: typeof idle; actions: ReadonlyArray<ShortcutAction> }>(
    ({ state, actions }, next) => {
      const after = nextKeyState(state, next)
      return {
        state: after,
        actions: after.action === null ? actions : [...actions, after.action],
      }
    },
    { state: idle, actions: [] },
  ).actions

const typed = (text: string) => actionsOf([...text].map((key) => press(key)))

describe("shell shortcuts", () => {
  it("runs Logseq's two-key sequences", () => {
    expect(typed("tl")).toEqual(["ToggleLeftSidebar"])
    expect(typed("trtt")).toEqual(["ToggleRightSidebar", "ToggleTheme"])
    expect(typed("twgjgagh")).toEqual(["ToggleWideMode", "GoJournals", "GoAllPages", "GoHome"])
    expect(typed("gsct")).toEqual(["GoShortcuts", "CloseTopSidebarItem"])
  })

  it("ignores keys that start no sequence and restarts after a miss", () => {
    expect(typed("xtl")).toEqual(["ToggleLeftSidebar"])
    expect(typed("tx")).toEqual([])
    expect(typed("ttl")).toEqual(["ToggleTheme"])
  })

  it("uses the physical key for Alt chords", () => {
    expect(actionsOf([press("Ç", { code: "KeyC", altKey: true, shiftKey: true })])).toEqual([
      "ToggleContents",
    ])
    expect(actionsOf([press("Ô", { code: "KeyJ", altKey: true, shiftKey: true })])).toEqual([
      "OpenTodayInSidebar",
    ])
  })

  it("opens help on ? and leaves Ctrl and Cmd combos alone", () => {
    expect(actionsOf([press("?", { code: "Slash", shiftKey: true })])).toEqual(["ToggleHelp"])
    expect(actionsOf([press("t"), press("l", { ctrlKey: true })])).toEqual([])
    expect(actionsOf([press("t", { metaKey: true }), press("l")])).toEqual([])
    expect(actionsOf([press("T", { code: "KeyT", shiftKey: true }), press("l")])).toEqual([])
  })

  it("labels each action with its keys", () => {
    expect(keysOf("ToggleRightSidebar")).toEqual(["t", "r"])
    expect(keysOf("ToggleContents")).toEqual(["alt", "shift", "c"])
    expect(keysOf("ToggleHelp")).toEqual(["?"])
  })
})

describe("recent pages", () => {
  it("puts the latest visit first without duplicates", () => {
    expect(remember(["garden plan", "reading list"], "seed inventory")).toEqual([
      "seed inventory",
      "garden plan",
      "reading list",
    ])
    expect(remember(["garden plan", "reading list"], "reading list")).toEqual([
      "reading list",
      "garden plan",
    ])
  })

  it("keeps the list unchanged when the page is already on top", () => {
    const recent = ["garden plan", "reading list"]
    expect(remember(recent, "garden plan")).toBe(recent)
  })

  it("keeps the 15 most recent pages", () => {
    const fifteen = Array.from({ length: 15 }, (_, index) => `page ${index}`)
    const next = remember(fifteen, "new page")
    expect(next.length).toBe(15)
    expect(next[0]).toBe("new page")
    expect(next.at(-1)).toBe("page 13")
  })
})

describe("sidebar widths", () => {
  it("clamps the left sidebar between 240 and 460 pixels", () => {
    expect(leftWidthAt(120)).toBe(240)
    expect(leftWidthAt(300.4)).toBe(300)
    expect(leftWidthAt(900)).toBe(460)
  })

  it("sizes the right sidebar as a share of the window and hides it near the edge", () => {
    expect(rightWidthAt(864, 1440)).toEqual({ _tag: "Shown", percent: 40 })
    expect(rightWidthAt(200, 1440)).toEqual({ _tag: "Shown", percent: 70 })
    expect(rightWidthAt(1100, 1440)).toEqual({ _tag: "Shown", percent: 23.6 })
    expect(rightWidthAt(1200, 1440)).toEqual({ _tag: "Shown", percent: 22.2 })
    expect(rightWidthAt(1420, 1440)).toEqual({ _tag: "Hidden" })
  })

  it("steps the right sidebar width from the keyboard within its bounds", () => {
    expect(rightWidthStep(40, 72, 1440)).toBe(45)
    expect(rightWidthStep(70, 72, 1440)).toBe(70)
    expect(rightWidthStep(23, -72, 1440)).toBe(22.2)
  })
})
