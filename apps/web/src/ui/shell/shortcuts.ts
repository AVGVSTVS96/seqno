export const onMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.userAgent)

export type ShortcutAction =
  | "ToggleTheme"
  | "ToggleLeftSidebar"
  | "ToggleRightSidebar"
  | "ToggleWideMode"
  | "ToggleDocumentMode"
  | "PickAccentColor"
  | "ResetAccentColor"
  | "ToggleBrackets"
  | "ToggleHelp"
  | "GoJournals"
  | "GoHome"
  | "GoAllPages"
  | "GoGraphView"
  | "GoWhiteboards"
  | "NewWhiteboard"
  | "GoShortcuts"
  | "CloseTopSidebarItem"
  | "ToggleContents"
  | "OpenTodayInSidebar"
  | "ToggleSettings"
  | "GoPlugins"
  | "SelectThemeColor"
  | "SearchThemes"
  | "GoBackward"
  | "GoForward"
  | "ToggleFavorite"
  | "GoNextJournal"
  | "GoPrevJournal"
  | "GoTomorrow"
  | "ToggleOpenBlocks"
  | "SelectGraph"
  | "RebuildIndex"
  | "GitCommit"
  | "RunCommand"

const bindings: ReadonlyArray<readonly [string, ShortcutAction]> = [
  ["t t", "ToggleTheme"],
  ["t l", "ToggleLeftSidebar"],
  ["t r", "ToggleRightSidebar"],
  ["t w", "ToggleWideMode"],
  ["t d", "ToggleDocumentMode"],
  ["c c", "PickAccentColor"],
  ["c o", "ResetAccentColor"],
  ["?", "ToggleHelp"],
  ["g j", "GoJournals"],
  ["g h", "GoHome"],
  ["g a", "GoAllPages"],
  ["g g", "GoGraphView"],
  ["g w", "GoWhiteboards"],
  ["n w", "NewWhiteboard"],
  ["g s", "GoShortcuts"],
  ["c t", "CloseTopSidebarItem"],
  ["alt shift c", "ToggleContents"],
  ["alt shift j", "OpenTodayInSidebar"],
  ["t s", "ToggleSettings"],
  ["t p", "GoPlugins"],
  ["t i", "SelectThemeColor"],
  [onMac ? "mod shift i" : "alt shift i", "SearchThemes"],
  ["mod [", "GoBackward"],
  ["mod ]", "GoForward"],
  ["mod shift f", "ToggleFavorite"],
  ["g n", "GoNextJournal"],
  ["g p", "GoPrevJournal"],
  ["g t", "GoTomorrow"],
  ["t o", "ToggleOpenBlocks"],
  ["alt shift g", "SelectGraph"],
  ["mod c then mod s", "RebuildIndex"],
  ["mod c then mod b", "ToggleBrackets"],
  ["mod g then c", "GitCommit"],
  ["mod shift 1", "RunCommand"],
]

export const keysOf = (action: ShortcutAction): readonly string[] =>
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
  press.code.startsWith("Key")
    ? press.code.slice(3).toLowerCase()
    : press.code.startsWith("Digit")
      ? press.code.slice(5)
      : press.key.toLowerCase()

const modPressed = (press: KeyPress) => (onMac ? press.metaKey : press.ctrlKey)

const modifierKeys = new Set(["Control", "Meta", "Shift", "Alt"])

export const nextKeyState = (state: KeyState, press: KeyPress): KeyState => {
  if (modifierKeys.has(press.key)) {
    return { ...state, action: null }
  }

  const letter = letterOf(press)

  if (press.ctrlKey || press.metaKey) {
    if (!modPressed(press) || press.altKey) {
      return idle
    }

    const step = `mod ${press.shiftKey ? "shift " : ""}${letter}`
    const chord = state.pending === null ? null : actionFor(`${state.pending} then ${step}`)

    if (chord !== null) {
      return { pending: null, action: chord }
    }

    const starts = bindings.some(([keys]) => keys.startsWith(`${step} then `))

    return { pending: starts ? step : null, action: actionFor(step) }
  }

  if (press.key === "?") {
    return { pending: null, action: actionFor("?") }
  }

  if (press.altKey) {
    return { pending: null, action: actionFor(`alt ${press.shiftKey ? "shift " : ""}${letter}`) }
  }

  if (press.shiftKey || letter.length !== 1) {
    return idle
  }

  const action =
    state.pending === null
      ? null
      : (actionFor(`${state.pending} ${letter}`) ?? actionFor(`${state.pending} then ${letter}`))

  if (action !== null) {
    return { pending: null, action }
  }

  const starts = bindings.some(([keys]) => keys.startsWith(`${letter} `))

  return { pending: starts ? letter : null, action: null }
}
