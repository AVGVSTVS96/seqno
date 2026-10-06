import { Schema } from "effect"
import { BlockId, PageId } from "./ids.ts"

export const Props = Schema.Record(Schema.String, Schema.String)
export type Props = typeof Props.Type

export const normalizePageName = (title: string): string =>
  title.normalize("NFC").trim().toLowerCase()

export const PageName = Schema.String.check(
  Schema.makeFilter((name: string) => name === normalizePageName(name) && name.length > 0, {
    expected: "a page name that is non-empty, NFC-normalized, trimmed and lowercase",
  }),
)

const isCalendarDay = (day: number): boolean => {
  const year = Math.floor(day / 10000)
  const month = Math.floor(day / 100) % 100
  const date = day % 100
  const parsed = new Date(Date.UTC(year, month - 1, date))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
  )
}

export const JournalDay = Schema.Int.check(
  Schema.isBetween({ minimum: 10000101, maximum: 99991231 }),
  Schema.makeFilter(isCalendarDay, { expected: "a real calendar day as YYYYMMDD" }),
)
export type JournalDay = typeof JournalDay.Type

export const Block = Schema.Struct({
  id: BlockId,
  pageId: PageId,
  parentId: Schema.NullOr(BlockId),
  text: Schema.String,
  collapsed: Schema.Boolean,
  props: Props,
})
export type Block = typeof Block.Type

export const Page = Schema.Struct({
  id: PageId,
  name: PageName,
  title: Schema.String,
  journalDay: Schema.NullOr(JournalDay),
  props: Props,
})
export type Page = typeof Page.Type
