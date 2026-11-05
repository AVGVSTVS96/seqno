import { BrowserKeyValueStore } from "@effect/platform-browser"
import { Schema } from "effect"
import { Atom } from "effect/reactivity"

export const ThemeMode = Schema.Literals(["light", "dark"])

export type ThemeMode = typeof ThemeMode.Type

export const PluginTheme = Schema.Struct({
  pid: Schema.String,
  name: Schema.String,
  url: Schema.String,
  mode: Schema.NullOr(ThemeMode),
  description: Schema.String,
})

export type PluginTheme = typeof PluginTheme.Type

export const PluginInfo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  author: Schema.String,
  version: Schema.String,
  repo: Schema.NullOr(Schema.String),
  icon: Schema.NullOr(Schema.String),
  root: Schema.String,
  main: Schema.NullOr(Schema.String),
  themes: Schema.Array(PluginTheme),
  package: Schema.Record(Schema.String, Schema.Unknown),
})

export type PluginInfo = typeof PluginInfo.Type

export const Settings = Schema.Record(Schema.String, Schema.Unknown)

export type Settings = typeof Settings.Type

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

const stored = <S extends Schema.ConstraintCodec<unknown, unknown>>(
  key: string,
  schema: S,
  defaultValue: S["Type"],
) =>
  Atom.kvs({ runtime: storage, key, schema, defaultValue: () => defaultValue }).pipe(Atom.keepAlive)

export const installedPlugins = stored(
  "seqno.plugins.installed",
  Schema.Array(PluginInfo),
  [] satisfies readonly PluginInfo[],
)

export const pluginSettings = Atom.family((pid: string) =>
  stored(`seqno.plugins.settings.${pid}`, Settings, { disabled: false } satisfies Settings),
)

export const MainUILayout = Schema.Struct({
  left: Schema.Number,
  top: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  vw: Schema.Number,
  vh: Schema.Number,
})

export const mainUILayout = Atom.family((pid: string) =>
  stored(`seqno.plugins.layouts.${pid}`, Schema.NullOr(MainUILayout), null),
)

export const ChosenTheme = Schema.Struct({ pid: Schema.String, url: Schema.String })

export type ChosenTheme = typeof ChosenTheme.Type

export const chosenThemes = stored(
  "seqno.plugins.themes",
  Schema.Struct({ light: Schema.NullOr(ChosenTheme), dark: Schema.NullOr(ChosenTheme) }),
  { light: null, dark: null },
)

export const pinnedToolbarItems = stored(
  "seqno.plugins.pinnedToolbarItems",
  Schema.NullOr(Schema.Array(Schema.String)),
  null,
)

export interface UIItem {
  readonly pid: string
  readonly key: string
  readonly type: "toolbar" | "pagebar"
  readonly template: string
}

export type SlashAction = readonly unknown[]

export interface PluginSlashCommand {
  readonly pid: string
  readonly label: string
  readonly actions: readonly SlashAction[]
}

export interface Keybinding {
  readonly binding: readonly string[]
  readonly mac: readonly string[]
  readonly mode: "global" | "non-editing" | "editing"
}

export interface PluginCommand {
  readonly pid: string
  readonly key: string
  readonly label: string
  readonly type: string
  readonly keybinding: Keybinding | null
  readonly palette: boolean
  readonly eventKey: string
  readonly clearSelection: boolean
}

export interface SettingItem {
  readonly key: string
  readonly type: string
  readonly title: string
  readonly description: string
  readonly default: unknown
  readonly inputAs: string | null
  readonly enumChoices: readonly string[]
  readonly enumPicker: string | null
  readonly buttonAction: string | null
}

export type Status =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Failed"; readonly reason: string }

export interface Running {
  readonly status: Status
  readonly schema: readonly SettingItem[]
  readonly mainUI: boolean
}

export interface ComingUpdate {
  readonly pid: string
  readonly title: string
  readonly version: string
  readonly latest: PluginInfo
  readonly failed: string | null
}

export const updatesComing = Atom.make<readonly ComingUpdate[]>([]).pipe(Atom.keepAlive)

export const running = Atom.make<Readonly<Record<string, Running>>>({}).pipe(Atom.keepAlive)

export const uiItems = Atom.make<readonly UIItem[]>([]).pipe(Atom.keepAlive)

export const slashCommands = Atom.make<readonly PluginSlashCommand[]>([]).pipe(Atom.keepAlive)

export const pluginCommands = Atom.make<readonly PluginCommand[]>([]).pipe(Atom.keepAlive)

export const runtimeThemes = Atom.make<readonly PluginTheme[]>([]).pipe(Atom.keepAlive)

export const settingsFor = Atom.make<string | null>(null).pipe(Atom.keepAlive)

export interface LegacyProps {
  readonly content: string
}

export interface LegacyElement {
  readonly props: LegacyProps
}

export type LegacyComponent = (props: LegacyProps) => LegacyElement | null

export interface FencedRenderer {
  readonly pid: string
  readonly type: string
  readonly edit: boolean
  readonly render: LegacyComponent
}

export const fencedRenderers = Atom.make<readonly FencedRenderer[]>([]).pipe(Atom.keepAlive)
