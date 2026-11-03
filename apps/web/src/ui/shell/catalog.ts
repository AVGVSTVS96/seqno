import { editorBindings, type Binding } from "@seqno/editor"
import { keysOf, onMac, type ShortcutAction } from "./shortcuts.ts"

export interface Shortcut {
  readonly label: string
  readonly combos: ReadonlyArray<ReadonlyArray<string>>
}

export interface ShortcutGroup {
  readonly title: string
  readonly shortcuts: ReadonlyArray<Shortcut>
}

const keysIn = (codeMirrorKey: string) =>
  codeMirrorKey.split(/-(?!$)/).map((part) => part.toLowerCase())

const editing = ({ label, key, mac }: Binding): Shortcut => ({
  label,
  combos: [keysIn(onMac ? (mac ?? key) : key)],
})

const app = (label: string, action: ShortcutAction): Shortcut => ({
  label,
  combos: [keysOf(action)],
})

const keys = (label: string, ...combos: ReadonlyArray<string>): Shortcut => ({
  label,
  combos: combos.map((combo) => combo.split(" ")),
})

const moveChord = onMac ? "mod shift" : "alt shift"

export const shortcutGroups: ReadonlyArray<ShortcutGroup> = [
  {
    title: "Basics",
    shortcuts: [
      keys("Search pages and blocks", "mod k"),
      keys("Search commands", "mod shift p"),
      keys("Search blocks in page", "mod shift k"),
      editing(editorBindings.newBlock),
      editing(editorBindings.newLine),
      editing(editorBindings.indent),
      editing(editorBindings.outdent),
      keys("Undo", "mod z"),
      keys("Redo", "mod shift z", "mod y"),
      keys("Copy the selected blocks", "mod c"),
      keys("Cut the selected blocks", "mod x"),
      keys("Select all blocks", "mod shift a"),
      keys("Select the parent block", "mod a"),
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      app("Go to journals", "GoJournals"),
      app("Go home", "GoHome"),
      app("Go to all pages", "GoAllPages"),
      app("Go to graph view", "GoGraphView"),
      app("Go to whiteboards", "GoWhiteboards"),
      app("New whiteboard", "NewWhiteboard"),
      app("Go to keyboard shortcuts", "GoShortcuts"),
      app("Go to plugins dashboard", "GoPlugins"),
      app("Backwards", "GoBackward"),
      app("Forwards", "GoForward"),
      app("Add to/remove from favorites", "ToggleFavorite"),
      editing(editorBindings.zoomIn),
      editing(editorBindings.zoomOut),
      editing(editorBindings.follow),
      editing(editorBindings.followInSidebar),
    ],
  },
  {
    title: "Editing",
    shortcuts: [
      editing(editorBindings.bold),
      editing(editorBindings.italic),
      editing(editorBindings.highlight),
      editing(editorBindings.strike),
      editing(editorBindings.link),
      editing(editorBindings.cycleTask),
      editing(editorBindings.moveUp),
      editing(editorBindings.moveDown),
      editing(editorBindings.collapse),
      editing(editorBindings.expand),
      editing(editorBindings.toggleCollapse),
      editing(editorBindings.exit),
    ],
  },
  {
    title: "Selected blocks",
    shortcuts: [
      editing(editorBindings.selectAbove),
      editing(editorBindings.selectBelow),
      keys("Edit the selected block", "enter"),
      keys("Open the selected block in the sidebar", "shift enter"),
      keys("Move the selected blocks", `${moveChord} arrowup`, `${moveChord} arrowdown`),
      keys("Indent or outdent the selected blocks", "tab", "shift tab"),
      keys("Cycle the task marker of the selected blocks", "mod enter"),
      keys("Delete the selected blocks", "backspace"),
      keys("Clear the selection", "escape"),
    ],
  },
  {
    title: "Vim mode",
    shortcuts: [
      keys("Normal mode, then select the block", "escape"),
      keys("Next or previous block", "j", "k"),
      keys("First or last block", "g g", "shift g"),
      keys("Edit the block at its start or end", "i", "a"),
      keys("New block below or above", "o", "shift o"),
      keys("Delete the selected blocks", "d d"),
      keys("Copy the selected blocks", "y y"),
      keys("Paste blocks below or above", "p", "shift p"),
      keys("Indent or outdent the selected blocks", "> >", "< <"),
      keys("Collapse, expand or toggle children", "z c", "z o", "z a"),
      keys("Select whole blocks", "shift v"),
      keys("Undo or redo", "u", "ctrl r"),
    ],
  },
  {
    title: "Sidebars",
    shortcuts: [
      app("Toggle the left sidebar", "ToggleLeftSidebar"),
      app("Toggle the right sidebar", "ToggleRightSidebar"),
      app("Toggle Contents in the sidebar", "ToggleContents"),
      app("Open today's journal in the sidebar", "OpenTodayInSidebar"),
      app("Close the top item in the right sidebar", "CloseTopSidebarItem"),
    ],
  },
  {
    title: "Appearance",
    shortcuts: [
      app("Toggle dark and light theme", "ToggleTheme"),
      app("Toggle wide mode", "ToggleWideMode"),
      app("Toggle help", "ToggleHelp"),
      app("Toggle settings", "ToggleSettings"),
      app("Select available theme colors", "SelectThemeColor"),
      app("Search themes", "SearchThemes"),
    ],
  },
]

export const matchingGroups = (query: string): ReadonlyArray<ShortcutGroup> => {
  const wanted = query.trim().toLowerCase()
  return shortcutGroups.flatMap((group) => {
    const shortcuts = group.shortcuts.filter(
      (shortcut) => wanted === "" || shortcut.label.toLowerCase().includes(wanted),
    )
    return shortcuts.length === 0 ? [] : [{ ...group, shortcuts }]
  })
}
