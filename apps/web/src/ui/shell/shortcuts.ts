export type ShortcutAction =
  | "ToggleTheme"
  | "ToggleLeftSidebar"
  | "ToggleRightSidebar"
  | "ToggleWideMode"
  | "ToggleHelp"
  | "GoJournals"
  | "GoHome"
  | "GoAllPages"
  | "GoShortcuts"
  | "CloseTopSidebarItem"
  | "ToggleContents"
  | "OpenTodayInSidebar"

const bindings: ReadonlyArray<readonly [string, ShortcutAction]> = [
  ["t t", "ToggleTheme"],
  ["t l", "ToggleLeftSidebar"],
  ["t r", "ToggleRightSidebar"],
  ["t w", "ToggleWideMode"],
  ["?", "ToggleHelp"],
  ["g j", "GoJournals"],
  ["g h", "GoHome"],
  ["g a", "GoAllPages"],
  ["g s", "GoShortcuts"],
  ["c t", "CloseTopSidebarItem"],
  ["alt shift c", "ToggleContents"],
  ["alt shift j", "OpenTodayInSidebar"],
]

export const keysOf = (action: ShortcutAction): ReadonlyArray<string> =>
  bindings.find(([, bound]) => bound === action)?.[0].split(" ") ?? []

const actionFor = (keys: string) => bindings.find(([bound]) => bound === keys)?.[1] ?? null

export interface KeyPress {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

export interface KeyState {
  readonly pending: string | null
  readonly action: ShortcutAction | null
}

export const idle: KeyState = { pending: null, action: null }

const letterOf = (press: KeyPress) =>
  press.code.startsWith("Key") ? press.code.slice(3).toLowerCase() : press.key.toLowerCase()

export const nextKeyState = (state: KeyState, press: KeyPress): KeyState => {
  if (press.ctrlKey || press.metaKey) return idle
  if (press.key === "?") return { pending: null, action: actionFor("?") }
  const letter = letterOf(press)
  if (press.altKey) {
    return { pending: null, action: actionFor(`alt ${press.shiftKey ? "shift " : ""}${letter}`) }
  }
  if (press.shiftKey || letter.length !== 1) return idle
  const action = state.pending === null ? null : actionFor(`${state.pending} ${letter}`)
  if (action !== null) return { pending: null, action }
  const starts = bindings.some(([keys]) => keys.startsWith(`${letter} `))
  return { pending: starts ? letter : null, action: null }
}

export const onMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
