import { flow, Match, Option, Schema } from "effect"
import type { PluginInfo, PluginTheme, SettingItem } from "./state.ts"

export const Fields = Schema.Record(Schema.String, Schema.Unknown)

export type Fields = typeof Fields.Type

const noFields: Fields = {}

const Scalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])

export const asFields = Schema.decodeUnknownOption(Fields)

export const record = flow(
  asFields,
  Option.getOrElse(() => noFields),
)

export const text = flow(Schema.decodeUnknownOption(Schema.String), Option.getOrNull)

export const amount = flow(Schema.decodeUnknownOption(Schema.Number), Option.getOrNull)

export const asList = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))

export const list = flow(
  asList,
  Option.getOrElse((): readonly unknown[] => []),
)

export const scalarText = flow(
  Schema.decodeUnknownOption(Scalar),
  Option.map(String),
  Option.getOrNull,
)

export const texts = Match.type<unknown>().pipe(
  Match.when(Match.string, (one) => [one]),
  Match.orElse((value) => list(value).flatMap((item) => scalarText(item) ?? [])),
)

export const strings = flow(record, (fields): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(fields).flatMap(([key, item]) => {
      const value = scalarText(item)

      return value === null ? [] : [[key, value]]
    }),
  ),
)

const resolve = (root: string, path: string) => new URL(path, root).href

export const themesOf = (
  pid: string,
  root: string,
  entries: readonly unknown[],
): readonly PluginTheme[] =>
  entries.flatMap((entry) => {
    const theme = record(entry)
    const url = text(theme["url"])

    if (url === null) {
      return []
    }

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

const themeEntries = (logseq: Fields) => {
  const themes = logseq["themes"] ?? logseq["theme"]

  return themes === undefined ? [] : Option.getOrElse(asList(themes), () => [themes])
}

export interface Listing {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly author: string
  readonly repo: string | null
  readonly icon: string | null
}

export const pluginInfoOf = (listing: Listing, root: string, pkg: Fields): PluginInfo => {
  const logseq = record(pkg["logseq"])
  const main = text(logseq["entry"]) ?? text(logseq["main"]) ?? text(pkg["main"])
  const icon = text(logseq["icon"])

  return {
    id: listing.id,
    title: listing.title === "" ? (text(logseq["title"]) ?? listing.id) : listing.title,
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

export const settingItems = (entries: readonly unknown[]): readonly SettingItem[] =>
  entries.flatMap((entry) => {
    const item = record(entry)
    const key = text(item["key"])
    const type = text(item["type"])

    if (key === null || type === null) {
      return []
    }

    return [
      {
        key,
        type,
        title: text(item["title"]) ?? "",
        description: text(item["description"]) ?? "",
        default: item["default"] ?? null,
        inputAs: text(item["inputAs"]),
        enumChoices: list(item["enumChoices"]).flatMap((choice) => scalarText(choice) ?? []),
        enumPicker: text(item["enumPicker"]),
        buttonAction: text(item["buttonAction"]),
      },
    ]
  })
