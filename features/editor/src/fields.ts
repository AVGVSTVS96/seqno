import type { Transaction } from "@codemirror/state"
import type { Block, BlockId, Command, PropertyTarget, Props } from "@seqno/domain"
import {
  draftOffset,
  isHiddenProperty,
  joinProperties,
  splitProperties,
  textOffset,
  type PropertyLine,
} from "@seqno/syntax"
import { editTextCommands, minimalChange } from "./edits.ts"

interface Fields {
  readonly text: string
  readonly props: ReadonlyArray<PropertyLine>
}

export interface BlockFields {
  readonly draftOf: (block: Pick<Block, "text" | "props">) => string
  readonly draftCaret: (block: Pick<Block, "text" | "props">, offset: number) => number
  readonly textCaret: (draft: string, offset: number) => number
  readonly textOf: (draft: string) => string
  readonly reset: (block: Pick<Block, "text" | "props">) => void
  readonly commit: (transaction: Transaction) => ReadonlyArray<Command>
}

const propertyLine = /^([^\s:]+):: (.*)$/

const pageFields = (draft: string): Fields => {
  const props: Array<PropertyLine> = []
  for (const line of draft.split("\n")) {
    const match = propertyLine.exec(line)
    const key = match?.[1]
    const value = match?.[2]
    if (key !== undefined && value !== undefined && !props.some(([seen]) => seen === key)) {
      props.push([key, value])
    }
  }
  return { text: "", props }
}

const sameLines = (left: ReadonlyArray<PropertyLine>, right: ReadonlyArray<PropertyLine>) =>
  left.length === right.length &&
  left.every(([key, value], at) => right[at]?.[0] === key && right[at]?.[1] === value)

export const blockFields = (
  blockId: BlockId,
  block: Pick<Block, "text" | "props">,
  target: PropertyTarget = { _tag: "BlockTarget", blockId },
  hidden: (key: string) => boolean = isHiddenProperty,
): BlockFields => {
  let order: ReadonlyArray<string> = []

  const rank = (key: string) => {
    const at = order.indexOf(key)
    return at === -1 ? order.length : at
  }

  const linesOf = (props: Props): ReadonlyArray<PropertyLine> =>
    Object.entries(props)
      .filter(([key]) => order.includes(key) || !hidden(key))
      .toSorted(([left], [right]) => rank(left) - rank(right))

  const fieldsOf = (source: Pick<Block, "text" | "props">): Fields => ({
    text: source.text,
    props: linesOf(source.props),
  })

  let committed = fieldsOf(block)
  order = committed.props.map(([key]) => key)

  const property = (key: string, value: string | null): Command => ({
    _tag: "SetProperty",
    target,
    key,
    value,
  })

  return {
    draftOf: (source) => {
      const fields = fieldsOf(source)
      return joinProperties(fields.text, fields.props)
    },
    draftCaret: (source, offset) => draftOffset(source.text, linesOf(source.props), offset),
    textCaret: (draft, offset) => textOffset(splitProperties(draft), offset),
    textOf: (draft) => splitProperties(draft).text,
    reset: (source) => {
      committed = fieldsOf(source)
    },
    commit: (transaction) => {
      const draft = transaction.newDoc.toString()
      const next = target._tag === "PageTarget" ? pageFields(draft) : splitProperties(draft)
      order = next.props.map(([key]) => key)
      const before = committed
      committed = { text: next.text, props: next.props }
      if (before.props.length === 0 && next.props.length === 0) {
        return editTextCommands(blockId, transaction)
      }
      const change = minimalChange(before.text, next.text)
      const edits: ReadonlyArray<Command> =
        before.text === next.text ? [] : [{ _tag: "EditText", blockId, ...change }]
      if (sameLines(before.props, next.props)) return edits
      const after = new Map(next.props)
      const was = new Map(before.props)
      return [
        ...edits,
        ...before.props.flatMap(([key]) => (after.has(key) ? [] : [property(key, null)])),
        ...next.props.flatMap(([key, value]) =>
          was.get(key) === value ? [] : [property(key, value)],
        ),
      ]
    },
  }
}
