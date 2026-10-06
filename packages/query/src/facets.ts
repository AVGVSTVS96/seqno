import { Schema } from "effect"

export const TaskFacets = Schema.Struct({
  status: Schema.NullOr(Schema.String),
  priority: Schema.NullOr(Schema.String),
  scheduled: Schema.NullOr(Schema.Int),
  deadline: Schema.NullOr(Schema.Int),
})
export type TaskFacets = typeof TaskFacets.Type

const Props = Schema.Array(Schema.Tuple([Schema.String, Schema.String]))

export const PageFacets = Schema.Struct({
  name: Schema.String,
  day: Schema.NullOr(Schema.Int),
  tags: Schema.Array(Schema.String),
  aliases: Schema.Array(Schema.String),
  namespaces: Schema.Array(Schema.String),
  props: Props,
})
export type PageFacets = typeof PageFacets.Type

export const BlockFacets = Schema.Struct({
  id: Schema.String,
  parent: Schema.NullOr(Schema.String),
  content: Schema.String,
  task: Schema.NullOr(TaskFacets),
  refs: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  props: Props,
  created: Schema.Finite,
  updated: Schema.Finite,
  page: PageFacets,
})
export type BlockFacets = typeof BlockFacets.Type

export const tokenize = (text: string): string[] | null =>
  /^\p{ASCII}*$/u.test(text)
    ? text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t !== "")
    : null
