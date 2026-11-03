import { createContext, type ComponentType, type KeyboardEvent } from "react"
import type { Block, BlockId, PageId } from "@seqno/domain"
import {
  blockContent,
  defaultPropertyConfig,
  type BlockContent,
  type Dialect,
  type PropertyConfig,
} from "@seqno/syntax"
import type { Navigate, NavigationTarget, OpenBlockMenu } from "./navigation.ts"
import { PlainTextEditor } from "./PlainTextEditor.tsx"
import type { EditorSlotProps } from "./slot.ts"

export type EmbedTarget =
  | { readonly _tag: "Block"; readonly blockId: BlockId }
  | { readonly _tag: "Page"; readonly name: string }

export interface Renderer {
  readonly navigate: Navigate
  readonly depth: number
  readonly localBlock: (uuid: string) => Block | undefined
  readonly Embed: ComponentType<{ readonly target: EmbedTarget; readonly bare?: boolean }>
  readonly Query: ComponentType<{ readonly query: string }>
  readonly editor: ComponentType<EditorSlotProps>
  readonly resolveAsset: (path: string) => string | undefined
  readonly openMenu: OpenBlockMenu | undefined
  readonly vim: boolean
  readonly readOnly: boolean
}

export const RenderContext = createContext<Renderer>({
  openMenu: undefined,
  navigate: () => undefined,
  depth: 0,
  localBlock: () => undefined,
  Embed: () => null,
  Query: () => null,
  editor: PlainTextEditor,
  resolveAsset: () => undefined,
  vim: false,
  readOnly: false,
})

export const PageDialects = createContext<(pageId: PageId) => Dialect>(() => "markdown")

export interface AssetActions {
  readonly openPdf: (url: string) => void
  readonly saveFiles: (
    files: ReadonlyArray<File>,
    dialect: Dialect,
  ) => Promise<ReadonlyArray<string>>
}

export const AssetActions = createContext<AssetActions>({
  openPdf: () => undefined,
  saveFiles: () => Promise.resolve([]),
})

export const PropertySettings = createContext<PropertyConfig>(defaultPropertyConfig)

export type SourceEdit = (from: number, to: number, insert: string) => void

export const BlockSource = createContext<SourceEdit | null>(null)

export const HostBlock = createContext<BlockId | null>(null)

export interface MacroSlotProps {
  readonly name: string
  readonly args: string
  readonly blockId: BlockId | null
}

export const BoardSlot = createContext<{
  readonly Board: ComponentType<{ readonly pageId: PageId }>
} | null>(null)

export const MacroSlot = createContext<{ readonly Slot: ComponentType<MacroSlotProps> } | null>(
  null,
)

export const maxDepth = 3

export interface Activation {
  readonly shiftKey: boolean
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

export const follow =
  (navigate: Navigate, target: NavigationTarget, inSidebar: NavigationTarget) =>
  (event: Activation) => {
    event.preventDefault()
    event.stopPropagation()
    navigate(event.shiftKey ? inSidebar : target)
  }

export const clickOnEnter = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Enter") event.currentTarget.click()
}

export const toPage = (navigate: Navigate, name: string) =>
  follow(navigate, { _tag: "Page", name }, { _tag: "SidebarPage", name })

const parsed = new Map<string, BlockContent>()
const cacheLimit = 4000

export const contentOf = (text: string, dialect: Dialect = "markdown"): BlockContent => {
  const key = dialect === "markdown" ? text : `${dialect}\u0000${text}`
  const hit = parsed.get(key)
  if (hit !== undefined) return hit
  const content = blockContent(text, dialect)
  if (parsed.size >= cacheLimit) {
    const oldest = parsed.keys().next().value
    if (oldest !== undefined) parsed.delete(oldest)
  }
  parsed.set(key, content)
  return content
}
