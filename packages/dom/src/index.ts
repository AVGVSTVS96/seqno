import { assetParts, type AssetParts } from "./assets.ts"
import { blockParts, type BlockParts } from "./block.ts"
import { cmdkParts, type CmdkParts } from "./cmdk.ts"
import { codeParts, type CodeParts } from "./code.ts"
import { contentParts, type ContentParts } from "./content.ts"
import { editorParts, type EditorParts } from "./editor.ts"
import { fileParts, type FileParts } from "./file.ts"
import { names, type LogseqNames, type Table } from "./names.ts"
import { pdfParts, type PdfParts } from "./pdf.ts"
import { pageParts, type PageParts } from "./page.ts"
import { pluginParts, type PluginParts } from "./plugins.ts"
import { selectParts, type SelectParts } from "./select.ts"
import { shellParts, type ShellParts } from "./shell.ts"
import { slideParts, type SlideParts } from "./slide.ts"

export {
  accentColors,
  accentScale,
  accentStyles,
  type AccentChoice,
  type AccentColor,
} from "./accents.ts"
export type { CodeLook, CodeStyle, TokenKind } from "./code.ts"
export { logseqDocument, type DocumentState } from "./document.ts"
export { gaps } from "./gaps.ts"
export { attributesOf, names, type LogseqNames, type Table } from "./names.ts"
export { refsOf, refsSelf, refsValue } from "./refs.ts"
export { selectorNames, type SelectorNames } from "./selectors.ts"
export type { SidebarItemType } from "./shell.ts"
export {
  logseqAttributes,
  logseqClasses,
  logseqIdPrefixes,
  logseqIds,
  vocabularyVersion,
} from "./vocabulary.ts"

type Parts = AssetParts &
  BlockParts &
  CmdkParts &
  CodeParts &
  ContentParts &
  EditorParts &
  FileParts &
  PageParts &
  PdfParts &
  PluginParts &
  SelectParts &
  ShellParts &
  SlideParts

const parts: Table<Parts> = {
  ...assetParts,
  ...blockParts,
  ...cmdkParts,
  ...codeParts,
  ...contentParts,
  ...editorParts,
  ...fileParts,
  ...pageParts,
  ...pdfParts,
  ...pluginParts,
  ...selectParts,
  ...shellParts,
  ...slideParts,
}

export const logseq = <K extends keyof Parts>(part: K, ...state: Parts[K]): LogseqNames => {
  const made = parts[part](...state)
  return { ...made, className: names(part, made.className) }
}
