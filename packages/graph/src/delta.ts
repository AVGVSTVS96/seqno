import type { Delta } from "loro-crdt"

type Op = Delta<string>

export type TextDelta = ReadonlyArray<Op>

const lengthOf = (op: Op): number => op.insert?.length ?? op.delete ?? op.retain ?? 0

const reader = (ops: TextDelta) => {
  let index = 0
  let offset = 0
  const peek = () => ops[index]
  return {
    more: () => index < ops.length,
    isInsert: () => peek()?.insert !== undefined,
    isDelete: () => peek()?.delete !== undefined,
    peekLength: () => {
      const op = peek()
      return op === undefined ? Infinity : lengthOf(op) - offset
    },
    next: (length = Infinity): Op => {
      const op = peek()
      if (op === undefined) return { retain: length }
      const start = offset
      const taken = Math.min(length, lengthOf(op) - offset)
      offset += taken
      if (offset === lengthOf(op)) {
        index++
        offset = 0
      }
      if (op.insert !== undefined) return { insert: op.insert.slice(start, start + taken) }
      return op.delete !== undefined ? { delete: taken } : { retain: taken }
    },
  }
}

const builder = () => {
  const ops: Array<Op> = []
  const push = (op: Op): void => {
    if (lengthOf(op) === 0) return
    const last = ops.at(-1)
    if (op.insert !== undefined && last?.delete !== undefined) {
      ops.pop()
      push(op)
      ops.push(last)
      return
    }
    if (op.insert !== undefined && last?.insert !== undefined) {
      ops[ops.length - 1] = { insert: last.insert + op.insert }
    } else if (op.delete !== undefined && last?.delete !== undefined) {
      ops[ops.length - 1] = { delete: last.delete + op.delete }
    } else if (op.retain !== undefined && last?.retain !== undefined) {
      ops[ops.length - 1] = { retain: last.retain + op.retain }
    } else {
      ops.push(op)
    }
  }
  const done = (): TextDelta => (ops.at(-1)?.retain === undefined ? ops : ops.slice(0, -1))
  return { push, done }
}

export const splice = (from: number, remove: number, insert: string): TextDelta => {
  const out = builder()
  out.push({ retain: from })
  out.push({ insert })
  out.push({ delete: remove })
  return out.done()
}

export const compose = (first: TextDelta, second: TextDelta): TextDelta => {
  const a = reader(first)
  const b = reader(second)
  const out = builder()
  while (a.more() || b.more()) {
    if (b.isInsert()) out.push(b.next())
    else if (a.isDelete()) out.push(a.next())
    else {
      const length = Math.min(a.peekLength(), b.peekLength())
      const left = a.next(length)
      const right = b.next(length)
      if (right.retain !== undefined) out.push(left)
      else if (left.retain !== undefined) out.push(right)
    }
  }
  return out.done()
}

export const transform = (applied: TextDelta, pending: TextDelta): TextDelta => {
  const a = reader(applied)
  const b = reader(pending)
  const out = builder()
  while (a.more() || b.more()) {
    if (a.isInsert()) out.push({ retain: lengthOf(a.next()) })
    else if (b.isInsert()) out.push(b.next())
    else {
      const length = Math.min(a.peekLength(), b.peekLength())
      const left = a.next(length)
      const right = b.next(length)
      if (left.delete === undefined) out.push(right)
    }
  }
  return out.done()
}

export const span = (delta: TextDelta): number =>
  delta.reduce((sum, op) => sum + (op.insert === undefined ? lengthOf(op) : 0), 0)

export const invert = (delta: TextDelta, base: string): TextDelta => {
  const out = builder()
  let at = 0
  for (const op of delta) {
    if (op.insert !== undefined) out.push({ delete: op.insert.length })
    else if (op.delete !== undefined) {
      out.push({ insert: base.slice(at, at + op.delete) })
      at += op.delete
    } else {
      out.push({ retain: lengthOf(op) })
      at += lengthOf(op)
    }
  }
  return out.done()
}
