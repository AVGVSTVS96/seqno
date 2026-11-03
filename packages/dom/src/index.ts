import { assetParts, type AssetParts } from "./assets.ts"
import { blockParts, type BlockParts } from "./block.ts"
import { cmdkParts, type CmdkParts } from "./cmdk.ts"
import { contentParts, type ContentParts } from "./content.ts"
import { names, type LogseqNames, type Table } from "./names.ts"
import { pdfParts, type PdfParts } from "./pdf.ts"
import { slideParts, type SlideParts } from "./slide.ts"

export { names, type LogseqNames, type Table } from "./names.ts"
export { refsSelf } from "./refs.ts"
export {
  logseqAttributes,
  logseqClasses,
  logseqIdPrefixes,
  logseqIds,
  vocabularyVersion,
} from "./vocabulary.ts"

type Parts = AssetParts & BlockParts & CmdkParts & ContentParts & PdfParts & SlideParts

const parts: Table<Parts> = {
  ...assetParts,
  ...blockParts,
  ...cmdkParts,
  ...contentParts,
  ...pdfParts,
  ...slideParts,
}

export const logseq = <K extends keyof Parts>(part: K, ...state: Parts[K]): LogseqNames => {
  const made = parts[part](...state)
  return { ...made, className: names(part, made.className) }
}
