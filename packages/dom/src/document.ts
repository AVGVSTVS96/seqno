import type { AccentChoice } from "./accents.ts"
import { names } from "./names.ts"
import type { LogseqNames } from "./names.ts"

export interface DocumentState {
  readonly mode: "light" | "dark"
  readonly route: string | undefined
  readonly platform: "mac" | "win32" | "linux"
  readonly color: AccentChoice
}

export interface LogseqDocument {
  readonly html: LogseqNames
  readonly body: LogseqNames
}

const pages: ReadonlyMap<string, string> = new Map([
  ["/", "home"],
  ["/page/$name", "page"],
  ["/all-pages", "all-pages"],
  ["/graph", "graph"],
  ["/whiteboards", "whiteboards"],
  ["/graphs", "repos"],
  ["/search", "home"],
])

export const logseqDocument = ({
  mode,
  route,
  platform,
  color,
}: DocumentState): LogseqDocument => ({
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L368-L375
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/theme.cljs#L40-L56
  html: {
    className: names(`is-${platform}`, mode === "dark" && "dark"),
    "data-theme": mode,
    "data-color": color,
  },
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/theme.cljs#L44-L48
  body: {
    className: mode === "dark" ? "dark-theme" : "white-theme light-theme",
    "data-page": (route === undefined ? undefined : pages.get(route)) ?? "home",
  },
})
