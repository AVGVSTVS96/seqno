import { createContext, type ComponentType, type KeyboardEvent } from "react"
import type { Block, BlockId } from "@seqno/domain"
import { blockContent, type BlockContent } from "@seqno/syntax"
import type { Navigate, NavigationTarget, OpenBlockMenu } from "./navigation.ts"
import { PlainTextEditor } from "./PlainTextEditor.tsx"
import type { EditorSlotProps } from "./slot.ts"

export type EmbedTarget =
  | { readonly _tag: "Block"; readonly blockId: BlockId }
  | { readonly _tag: "Page"; readonly name: string }

export interface Renderer {
  readonly navigate: Navigate
  readonly depth: number
  readonly localBlock: (blockId: BlockId) => Block | undefined
  readonly Embed: ComponentType<{ readonly target: EmbedTarget; readonly bare?: boolean }>
  readonly Query: ComponentType<{ readonly query: string }>
  readonly editor: ComponentType<EditorSlotProps>
  readonly resolveAsset: (path: string) => string | undefined
  readonly openMenu: OpenBlockMenu | undefined
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
})

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

export const contentOf = (text: string): BlockContent => {
  const hit = parsed.get(text)
  if (hit !== undefined) return hit
  const content = blockContent(text)
  if (parsed.size >= cacheLimit) {
    const oldest = parsed.keys().next().value
    if (oldest !== undefined) parsed.delete(oldest)
  }
  parsed.set(text, content)
  return content
}
