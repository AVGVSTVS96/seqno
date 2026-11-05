import { Schema } from "effect"

export const BlockKey = Schema.TaggedUnion({
  Move: { by: Schema.Int },
  Top: {},
  Bottom: {},
  Edit: { at: Schema.Literals(["Start", "End"]) },
  NewBlock: { below: Schema.Boolean },
  Delete: {},
  Yank: {},
  Put: { below: Schema.Boolean },
  Indent: {},
  Outdent: {},
  Fold: { collapsed: Schema.NullOr(Schema.Boolean) },
  Visual: {},
  Undo: {},
  Redo: {},
})

export type BlockKey = typeof BlockKey.Type

export interface BlockKeyRead {
  readonly pending: string
  readonly action: BlockKey | null
  readonly handled: boolean
}

const deleting: BlockKey = { _tag: "Delete" }
const yanking: BlockKey = { _tag: "Yank" }
const indenting: BlockKey = { _tag: "Indent" }
const outdenting: BlockKey = { _tag: "Outdent" }

const visualOperators = new Map<string, BlockKey>([
  ["d", deleting],
  ["x", deleting],
  ["y", yanking],
  [">", indenting],
  ["<", outdenting],
])

const normalOperators = new Map<string, BlockKey>([
  ["dd", deleting],
  ["yy", yanking],
  [">>", indenting],
  ["<<", outdenting],
])

const motions = new Map<string, BlockKey>([
  ["gg", { _tag: "Top" }],
  ["G", { _tag: "Bottom" }],
  ["i", { _tag: "Edit", at: "Start" }],
  ["I", { _tag: "Edit", at: "Start" }],
  ["a", { _tag: "Edit", at: "End" }],
  ["A", { _tag: "Edit", at: "End" }],
  ["o", { _tag: "NewBlock", below: true }],
  ["O", { _tag: "NewBlock", below: false }],
  ["p", { _tag: "Put", below: true }],
  ["P", { _tag: "Put", below: false }],
  ["zc", { _tag: "Fold", collapsed: true }],
  ["zo", { _tag: "Fold", collapsed: false }],
  ["za", { _tag: "Fold", collapsed: null }],
  ["V", { _tag: "Visual" }],
  ["u", { _tag: "Undo" }],
])

const actionOf = (keys: string, count: number, visual: boolean): BlockKey | null => {
  if (keys === "j" || keys === "k") {
    return { _tag: "Move", by: keys === "j" ? count : -count }
  }

  return (visual ? visualOperators : normalOperators).get(keys) ?? motions.get(keys) ?? null
}

const waitsFor = (keys: string, visual: boolean) =>
  keys === "" || keys === "g" || keys === "z" || (!visual && /^[dy><]$/u.test(keys))

export const readBlockKey = (pending: string, key: string, visual: boolean): BlockKeyRead => {
  if (key === "<C-r>") {
    return { pending: "", action: { _tag: "Redo" }, handled: true }
  }

  const typed = pending + key
  const [, digits = "", keys = ""] = /^([1-9]\d*)?(.*)$/u.exec(typed) ?? []
  const action = actionOf(keys, digits === "" ? 1 : Number(digits), visual)

  if (action !== null) {
    return { pending: "", action, handled: true }
  }

  if (waitsFor(keys, visual)) {
    return { pending: typed, action: null, handled: keys !== "g" }
  }

  return { pending: "", action: null, handled: false }
}
