import { Schema } from "effect"
import { Atom } from "effect/reactivity"
import { settingsLayer } from "../../atoms.ts"

const settingsRuntime = Atom.runtime((get) => get(settingsLayer))

const setting = <S extends Schema.ConstraintCodec<unknown, unknown>>(
  key: string,
  schema: S,
  defaultValue: S["Type"],
) =>
  Atom.kvs({ runtime: settingsRuntime, key, schema, defaultValue: () => defaultValue }).pipe(
    Atom.keepAlive,
  )

export const wideMode = setting("seqno.wideMode", Schema.Boolean, false)

export const leftSidebarWidth = setting("seqno.leftSidebarWidth", Schema.Finite, 246)

export const rightSidebarWidth = setting("seqno.rightSidebarWidth", Schema.Finite, 40)

export const SidebarGroup = Schema.Literals(["favorites", "recent"])
export type SidebarGroup = typeof SidebarGroup.Type

export const collapsedGroups = setting(
  "seqno.collapsedGroups",
  Schema.Array(SidebarGroup),
  [] satisfies ReadonlyArray<SidebarGroup>,
)

export const recentPages = setting(
  "seqno.recentPages",
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
  {} satisfies Readonly<Record<string, ReadonlyArray<string>>>,
)

const recentLimit = 15

export const remember = (recent: ReadonlyArray<string>, name: string): ReadonlyArray<string> =>
  recent[0] === name
    ? recent
    : [name, ...recent.filter((other) => other !== name)].slice(0, recentLimit)

export const leftSidebarBounds = { min: 240, max: 460 } as const

export const leftWidthAt = (pointerX: number) =>
  Math.round(Math.min(leftSidebarBounds.max, Math.max(leftSidebarBounds.min, pointerX)))

export type RightWidth =
  | { readonly _tag: "Hidden" }
  | { readonly _tag: "Shown"; readonly percent: number }

const rightMinPixels = 320
const rightMaxRatio = 0.7

export const rightWidthAt = (pointerX: number, windowWidth: number): RightWidth => {
  const minRatio = Math.max(0.1, rightMinPixels / windowWidth)
  const ratio = (windowWidth - pointerX) / windowWidth
  if (ratio < minRatio / 2) return { _tag: "Hidden" }
  const clamped = Math.min(rightMaxRatio, Math.max(minRatio, ratio))
  return { _tag: "Shown", percent: Math.round(clamped * 1000) / 10 }
}

export const rightWidthStep = (percent: number, pixels: number, windowWidth: number) => {
  const minRatio = Math.max(0.1, rightMinPixels / windowWidth)
  const ratio = percent / 100 + pixels / windowWidth
  return Math.round(Math.min(rightMaxRatio, Math.max(minRatio, ratio)) * 1000) / 10
}
