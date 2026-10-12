import { Match } from "effect"
import type {
  ContainerID,
  LoroDoc,
  LoroEventBatch,
  LoroMap,
  LoroText,
  LoroTreeNode,
  TreeID,
  Value,
} from "loro-crdt"
import type { BlockId } from "@seqno/domain"
import { compose, invert, span, splice, transform, type TextDelta } from "./delta.ts"
import { childrenOf, isTrash, propKeysIn, readProps, setProp, textOf } from "./tree.ts"

export interface Place {
  readonly doc: LoroDoc
  readonly roots: () => ReadonlyArray<LoroTreeNode>
  readonly root: (index?: number) => LoroTreeNode
  readonly trash: () => LoroTreeNode
}

interface Spot {
  readonly parent: LoroTreeNode | undefined
  readonly after: LoroTreeNode | undefined
  readonly index: number
}

interface Mapped {
  readonly by: Step
  readonly before: TextDelta
  readonly first: boolean
}

interface TextUndo {
  readonly _tag: "Text"
  readonly place: Place
  readonly text: LoroText
  delta: TextDelta
  readonly mapped: Array<Mapped>
}

interface ValueUndo {
  readonly _tag: "Value"
  readonly place: Place
  readonly map: LoroMap
  readonly key: string
  readonly value: Value
  expect: Value
}

interface PropUndo {
  readonly _tag: "Prop"
  readonly place: Place
  readonly map: LoroMap
  readonly key: string
  readonly value: string | null
  readonly after: string | null | undefined
  expect: string | null
}

interface MoveUndo {
  readonly _tag: "Move"
  readonly place: Place
  readonly node: LoroTreeNode
  readonly to: Spot
  readonly from: LoroTreeNode | undefined
}

interface DropUndo {
  readonly _tag: "Drop"
  readonly place: Place
  readonly node: LoroTreeNode
}

type Undo = TextUndo | ValueUndo | PropUndo | MoveUndo | DropUndo

type Keyed<A> = Map<LoroDoc, Map<string, A>>

type Listed = Map<LoroDoc, Map<TreeID | Place, Array<LoroTreeNode>>>

interface Step {
  readonly undos: Array<Undo>
  readonly latest: Keyed<TextUndo | ValueUndo | PropUndo>
  readonly created: Keyed<true>
  readonly restores: Map<TextUndo, { readonly post: TextDelta; readonly at: TextDelta }>
  commits: number
}

const emptyStep = (): Step => ({
  undos: [],
  latest: new Map(),
  created: new Map(),
  restores: new Map(),
  commits: 0,
})

const lookup = <A>(keyed: Keyed<A>, doc: LoroDoc, key: string): A | undefined =>
  keyed.get(doc)?.get(key)

const store = <A>(keyed: Keyed<A>, doc: LoroDoc, key: string, value: A): void => {
  const inDoc = keyed.get(doc)
  if (inDoc === undefined) keyed.set(doc, new Map([[key, value]]))
  else inDoc.set(key, value)
}

const keyOf = (undo: TextUndo | ValueUndo | PropUndo): string =>
  undo._tag === "Text"
    ? undo.text.id
    : `${undo.map.id}${undo._tag === "Value" ? ":" : "#"}${undo.key}`

const add = (step: Step, undo: Undo): void => {
  if (undo._tag === "Move" || undo._tag === "Drop") return void step.undos.push(undo)
  const known = lookup(step.latest, undo.place.doc, keyOf(undo))
  if (known === undefined) {
    store(step.latest, undo.place.doc, keyOf(undo), undo)
    step.undos.push(undo)
  } else if (known._tag === "Text" && undo._tag === "Text") {
    known.delta = compose(undo.delta, known.delta)
  } else if (known._tag !== "Text" && undo._tag !== "Text") known.expect = undo.expect
}

const absorb = (top: Step, step: Step): void => {
  step.undos.forEach((undo) => add(top, undo))
  for (const [doc, ids] of step.created) {
    for (const id of ids.keys()) store(top.created, doc, id, true)
  }
}

const textsOf = (step: Step): ReadonlyArray<TextUndo> =>
  step.undos.flatMap((undo) => (undo._tag === "Text" ? [undo] : []))

export interface Recorder {
  readonly children: (parent: LoroTreeNode) => ReadonlyArray<LoroTreeNode>
  readonly create: (parent: LoroTreeNode | undefined, index?: number) => LoroTreeNode
  readonly move: (node: LoroTreeNode, parent: LoroTreeNode | undefined, index?: number) => void
  readonly moveAfter: (node: LoroTreeNode, anchor: LoroTreeNode) => void
  readonly moveBefore: (node: LoroTreeNode, anchor: LoroTreeNode) => void
  readonly trash: (node: LoroTreeNode) => void
  readonly edit: (data: LoroMap, from: number, remove: number, insert: string) => void
  readonly set: (map: LoroMap, key: string, value: Value) => void
  readonly prop: (data: LoroMap, key: string, value: string | null, after?: string | null) => void
}

const scalar = (value: unknown): Value =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : value === null
      ? null
      : undefined

const sameNode = (a: LoroTreeNode | undefined, b: LoroTreeNode | undefined) => a?.id === b?.id

const isWithin = (target: LoroTreeNode | undefined, node: LoroTreeNode): boolean => {
  for (let at = target; at !== undefined; at = at.parent()) if (at.id === node.id) return true
  return false
}

const inTrash = (node: LoroTreeNode): boolean => {
  const parent = node.parent()
  return parent !== undefined && isTrash(parent)
}

const propAfter = (data: LoroMap, key: string): string | null | undefined => {
  const keys = propKeysIn(data)
  const at = keys.indexOf(key)
  return at === -1 ? undefined : (keys[at - 1] ?? null)
}

const editText = (place: Place, step: Step, text: LoroText, delta: TextDelta) => {
  const base = text.toString()
  let at = 0
  for (const op of delta) {
    if (op.insert !== undefined) {
      text.insert(at, op.insert)
      at += op.insert.length
    } else if (op.delete !== undefined) text.delete(at, op.delete)
    else at += op.retain
  }
  add(step, { _tag: "Text", place, text, delta: invert(delta, base), mapped: [] })
}

interface Restorer extends Recorder {
  readonly restore: (node: LoroTreeNode, to: Spot) => void
}

const recorder = (place: Place, step: Step, lists: Listed): Restorer => {
  const listed = lists.get(place.doc) ?? new Map<TreeID | Place, Array<LoroTreeNode>>()
  lists.set(place.doc, listed)
  const listOf = (parent: LoroTreeNode | undefined) => {
    const key = parent?.id ?? place
    const known = listed.get(key)
    if (known !== undefined) return known
    const children = [...(parent === undefined ? place.roots() : childrenOf(parent))]
    listed.set(key, children)
    return children
  }
  const cached = (parent: LoroTreeNode | undefined) => listed.get(parent?.id ?? place)
  const isNew = (node: LoroTreeNode) => lookup(step.created, place.doc, node.id) !== undefined
  const isNewMap = (map: LoroMap) => lookup(step.created, place.doc, map.id) !== undefined
  const moved = (node: LoroTreeNode, move: () => void) => {
    const parent = node.parent()
    const index = node.index() ?? 0
    const fromTrash = parent !== undefined && isTrash(parent)
    const after = fromTrash || index === 0 ? undefined : listOf(parent)[index - 1]
    move()
    const now = node.parent()
    cached(parent)?.splice(index, 1)
    cached(now)?.splice(node.index() ?? 0, 0, node)
    if (isNew(node)) return
    add(
      step,
      fromTrash
        ? { _tag: "Drop", place, node }
        : { _tag: "Move", place, node, to: { parent, after, index }, from: now },
    )
  }
  return {
    children: listOf,
    create: (parent, index) => {
      const node = parent === undefined ? place.root(index) : parent.createNode(index)
      cached(parent)?.splice(node.index() ?? 0, 0, node)
      if (parent === undefined || !isNew(parent)) add(step, { _tag: "Drop", place, node })
      store(step.created, place.doc, node.id, true)
      store(step.created, place.doc, node.data.id, true)
      return node
    },
    move: (node, parent, index) => moved(node, () => node.move(parent, index)),
    moveAfter: (node, anchor) => moved(node, () => node.moveAfter(anchor)),
    moveBefore: (node, anchor) => moved(node, () => node.moveBefore(anchor)),
    trash: (node) => moved(node, () => node.move(place.trash(), 0)),
    restore: (node, { parent, after, index }) => {
      if (parent?.isDeleted() === true || isWithin(parent, node)) return
      if (after !== undefined && !after.isDeleted() && sameNode(after.parent(), parent)) {
        return moved(node, () => node.moveAfter(after))
      }
      const others = listOf(parent).length - (sameNode(node.parent(), parent) ? 1 : 0)
      moved(node, () => node.move(parent, after === undefined ? 0 : Math.min(index, others)))
    },
    edit: (data, from, remove, insert) => {
      const delta = splice(from, remove, insert)
      if (delta.length === 0) return
      if (isNewMap(data)) textOf(data).splice(from, remove, insert)
      else editText(place, step, textOf(data), delta)
    },
    set: (map, key, value) => {
      const old = scalar(map.get(key))
      if (old === value) return
      if (!isNewMap(map)) add(step, { _tag: "Value", place, map, key, value: old, expect: value })
      if (value === undefined) map.delete(key)
      else map.set(key, value)
    },
    prop: (data, key, value, after) => {
      const old = readProps(data)[key] ?? null
      if (old === value) return
      if (!isNewMap(data)) {
        const before = propAfter(data, key)
        add(step, { _tag: "Prop", place, map: data, key, value: old, after: before, expect: value })
      }
      setProp(data, key, value, after)
    },
  }
}

const revertOne = (undo: Undo, record: Restorer, into: Step): void =>
  Match.valueTags(undo, {
    Text: ({ place, text, delta }) => {
      if (delta.length > 0 && !text.isDeleted() && span(delta) <= text.length) {
        editText(place, into, text, delta)
      }
    },
    Value: ({ map, key, value, expect }) => {
      if (!map.isDeleted() && scalar(map.get(key)) === expect) record.set(map, key, value)
    },
    Prop: ({ map, key, value, after, expect }) => {
      if (!map.isDeleted() && (readProps(map)[key] ?? null) === expect) {
        record.prop(map, key, value, after)
      }
    },
    Move: ({ node, to, from }) => {
      if (!node.isDeleted() && sameNode(node.parent(), from)) record.restore(node, to)
    },
    Drop: ({ node }) => {
      if (!node.isDeleted() && !inTrash(node)) record.trash(node)
    },
  })

const revert = (step: Step, lists: Listed): Step => {
  const into = emptyStep()
  const recorders = new Map<Place, Restorer>()
  const recorderOf = (place: Place) => {
    const known = recorders.get(place)
    if (known !== undefined) return known
    const made = recorder(place, into, lists)
    recorders.set(place, made)
    return made
  }
  for (const undo of step.undos.toReversed()) revertOne(undo, recorderOf(undo.place), into)
  return into
}

const MAX_STEPS = 100

interface Stacks {
  readonly undo: Array<Step>
  readonly redo: Array<Step>
  typing: { readonly block: BlockId; readonly step: Step } | undefined
}

interface Reverted {
  readonly from: Array<Step>
  readonly step: Step
  readonly to: Array<Step>
  readonly inverse: Step
}

export interface Transaction {
  readonly record: (place: Place) => Recorder
  readonly undo: () => void
  readonly redo: () => void
  readonly close: () => void
  readonly abort: () => void
}

interface Commit {
  readonly by: Step
  readonly reverts: Step | undefined
  readonly redoable: boolean
}

const mapThrough = (undo: TextUndo, delta: TextDelta, commit: Commit | undefined): void => {
  const before = undo.delta
  const top = undo.mapped.at(-1)
  if (commit === undefined) {
    undo.mapped.length = 0
    undo.delta = transform(delta, before)
    return
  }
  const { by, reverts, redoable } = commit
  if (reverts === undefined) {
    if (top?.by !== by) undo.mapped.push({ by, before, first: by.commits === 0 })
    undo.delta = transform(delta, before)
    return
  }
  const restore = reverts.restores.get(undo)
  if (restore !== undefined && restore.at === before) undo.delta = restore.post
  else if (top?.by === reverts && top.first) {
    undo.mapped.pop()
    undo.delta = top.before
  } else {
    undo.mapped.length = 0
    undo.delta = transform(delta, before)
  }
  if (redoable) by.restores.set(undo, { post: before, at: undo.delta })
  else undo.mapped.push({ by, before, first: true })
}

export const histories = () => {
  const clients = new Map<string, Stacks>()
  const watched = new Map<LoroDoc, Map<ContainerID, Set<TextUndo>>>()
  let muted = false
  let committing: Commit | undefined

  const attach = (step: Step) => {
    for (const undo of textsOf(step)) {
      const inDoc = watched.get(undo.place.doc) ?? new Map<ContainerID, Set<TextUndo>>()
      watched.set(undo.place.doc, inDoc)
      const undos = inDoc.get(undo.text.id) ?? new Set<TextUndo>()
      inDoc.set(undo.text.id, undos)
      undos.add(undo)
    }
  }
  const detach = (step: Step) => {
    for (const undo of textsOf(step)) {
      const inDoc = watched.get(undo.place.doc)
      const undos = inDoc?.get(undo.text.id)
      undos?.delete(undo)
      if (undos?.size === 0) inDoc?.delete(undo.text.id)
    }
  }
  const push = (stack: Array<Step>, step: Step) => {
    stack.push(step)
    attach(step)
    if (stack.length > MAX_STEPS) stack.splice(0, stack.length - MAX_STEPS).forEach(detach)
  }
  const clear = (stack: Array<Step>) => stack.splice(0).forEach(detach)
  const stacksOf = (client: string): Stacks => {
    const found = clients.get(client)
    if (found !== undefined) return found
    const made: Stacks = { undo: [], redo: [], typing: undefined }
    clients.set(client, made)
    return made
  }

  const observe = (doc: LoroDoc, batch: LoroEventBatch): void => {
    const inDoc = watched.get(doc)
    if (muted || inDoc === undefined || inDoc.size === 0) return
    for (const event of batch.events) {
      if (event.diff.type !== "text") continue
      for (const undo of inDoc.get(event.target) ?? []) {
        mapThrough(undo, event.diff.diff, committing)
      }
    }
  }

  const begin = (client: string, typing: BlockId | null, commit: () => void): Transaction => {
    const stacks = stacksOf(client)
    const draft = emptyStep()
    const lists: Listed = new Map()
    const reverted: Array<Reverted> = []
    const top = stacks.undo.at(-1)
    const grouped =
      typing !== null &&
      top !== undefined &&
      stacks.typing?.block === typing &&
      stacks.typing.step === top
    const step = (from: Array<Step>, to: Array<Step>) => {
      const popped = from.pop()
      if (popped === undefined) return
      detach(popped)
      reverted.push({ from, step: popped, to, inverse: revert(popped, lists) })
    }
    return {
      record: (place) => recorder(place, draft, lists),
      undo: () => step(stacks.undo, stacks.redo),
      redo: () => step(stacks.redo, stacks.undo),
      close: () => {
        const undone = reverted[0]
        const by = grouped ? top : (undone?.inverse ?? draft)
        if (grouped) detach(top)
        committing = { by, reverts: undone?.step, redoable: undone?.to === stacks.redo }
        commit()
        committing = undefined
        by.commits++
        if (draft.undos.length > 0) clear(stacks.redo)
        if (grouped) {
          absorb(top, draft)
          attach(top)
        } else if (draft.undos.length > 0) push(stacks.undo, draft)
        stacks.typing =
          typing !== null && (grouped || draft.undos.length > 0)
            ? { block: typing, step: grouped ? top : draft }
            : undefined
        for (const { to, inverse } of reverted) if (inverse.undos.length > 0) push(to, inverse)
      },
      abort: () => {
        revert(draft, lists)
        reverted.toReversed().forEach(({ inverse }) => revert(inverse, lists))
        muted = true
        commit()
        muted = false
        for (const { from, step: popped } of reverted.toReversed()) push(from, popped)
      },
    }
  }

  const release = (client: string): void => {
    const stacks = clients.get(client)
    if (stacks === undefined) return
    clear(stacks.undo)
    clear(stacks.redo)
    clients.delete(client)
  }

  return { observe, begin, release }
}
