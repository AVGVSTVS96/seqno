import { blockParts, type BlockParts } from "./block.ts"
import { names, type LogseqNames, type Table } from "./names.ts"

export { names, type LogseqNames, type Table } from "./names.ts"
export { refsSelf } from "./refs.ts"
export {
  logseqAttributes,
  logseqClasses,
  logseqIdPrefixes,
  logseqIds,
  vocabularyVersion,
} from "./vocabulary.ts"

type Parts = BlockParts

const parts: Table<Parts> = { ...blockParts }

export const logseq = <K extends keyof Parts>(part: K, ...state: Parts[K]): LogseqNames => {
  const made = parts[part](...state)
  return { ...made, className: names(part, made.className) }
}
