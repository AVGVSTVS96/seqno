import type { PluginInfo, PluginTheme, SettingItem } from "./state.ts"

export const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}

export const text = (value: unknown): string | null => (typeof value === "string" ? value : null)

export const list = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

export const strings = (value: unknown): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(record(value)).flatMap(([key, item]) =>
      item === null || item === undefined ? [] : [[key, String(item)]],
    ),
  )

const resolve = (root: string, path: string) => new URL(path, root).href

export const themesOf = (
  pid: string,
  root: string,
  entries: ReadonlyArray<unknown>,
): ReadonlyArray<PluginTheme> =>
  entries.flatMap((entry) => {
    const theme = record(entry)
    const url = text(theme["url"])
    if (url === null) return []
    const mode = theme["mode"]
    return [
      {
        pid,
        name: text(theme["name"]) ?? pid,
        url: resolve(root, url),
        mode: mode === "light" || mode === "dark" ? mode : null,
        description: text(theme["description"]) ?? "",
      },
    ]
  })

const themeEntries = (logseq: Readonly<Record<string, unknown>>) => {
  const themes = logseq["themes"] ?? logseq["theme"]
  return Array.isArray(themes) ? themes : themes === undefined ? [] : [themes]
}

export interface Listing {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly author: string
  readonly repo: string | null
  readonly icon: string | null
}

export const pluginInfoOf = (
  listing: Listing,
  root: string,
  pkg: Readonly<Record<string, unknown>>,
): PluginInfo => {
  const logseq = record(pkg["logseq"])
  const main = text(logseq["entry"]) ?? text(logseq["main"]) ?? text(pkg["main"])
  const icon = text(logseq["icon"])
  return {
    id: listing.id,
    title: text(logseq["title"]) ?? listing.title,
    description: text(pkg["description"]) ?? listing.description,
    author: text(pkg["author"]) ?? listing.author,
    version: text(pkg["version"]) ?? "0.0.0",
    repo: listing.repo,
    icon: icon === null ? listing.icon : resolve(root, icon),
    root,
    main,
    themes: themesOf(listing.id, root, themeEntries(logseq)),
    package: pkg,
  }
}

export const settingItems = (schema: unknown): ReadonlyArray<SettingItem> =>
  list(schema).flatMap((entry) => {
    const item = record(entry)
    const key = text(item["key"])
    const type = text(item["type"])
    if (key === null || type === null) return []
    return [
      {
        key,
        type,
        title: text(item["title"]) ?? "",
        description: text(item["description"]) ?? "",
        default: item["default"] ?? null,
        inputAs: text(item["inputAs"]),
        enumChoices: list(item["enumChoices"]).map(String),
        enumPicker: text(item["enumPicker"]),
        buttonAction: text(item["buttonAction"]),
      },
    ]
  })
