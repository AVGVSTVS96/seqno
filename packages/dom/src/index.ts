import { assetParts } from "./assets.ts"
import type { AssetParts } from "./assets.ts"
import { blockParts } from "./block.ts"
import type { BlockParts } from "./block.ts"
import { cmdkParts } from "./cmdk.ts"
import type { CmdkParts } from "./cmdk.ts"
import { codeParts } from "./code.ts"
import type { CodeParts } from "./code.ts"
import { contentParts } from "./content.ts"
import type { ContentParts } from "./content.ts"
import { editorParts } from "./editor.ts"
import type { EditorParts } from "./editor.ts"
import { fileParts } from "./file.ts"
import type { FileParts } from "./file.ts"
import { gitParts } from "./git.ts"
import type { GitParts } from "./git.ts"
import { names } from "./names.ts"
import type { LogseqNames, Table } from "./names.ts"
import { latexParts } from "./latex.ts"
import type { LatexParts } from "./latex.ts"
import { pdfParts } from "./pdf.ts"
import type { PdfParts } from "./pdf.ts"
import { pageParts } from "./page.ts"
import type { PageParts } from "./page.ts"
import { pluginParts } from "./plugins.ts"
import type { PluginParts } from "./plugins.ts"
import { selectParts } from "./select.ts"
import type { SelectParts } from "./select.ts"
import { shellParts } from "./shell.ts"
import type { ShellParts } from "./shell.ts"
import { slideParts } from "./slide.ts"
import type { SlideParts } from "./slide.ts"

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
  LatexParts &
  GitParts &
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
  ...latexParts,
  ...gitParts,
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
