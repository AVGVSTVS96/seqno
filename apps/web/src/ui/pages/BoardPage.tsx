import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { normalizePageName, type BlockId, type Page } from "@seqno/domain"
import { Board } from "@seqno/whiteboard"
import { assetResolver, rightSidebar } from "../../atoms.ts"
import { EditorSlot } from "../EditorSlot.tsx"
import { blockMenu } from "../shell/BlockMenu.tsx"
import { vimMode } from "../shell/state.ts"
import { useNavigateTo } from "./navigation.ts"

export const BoardPage = ({
  page,
  zoom,
}: {
  readonly page: Page
  readonly zoom: BlockId | null
}) => {
  const navigate = useNavigate()
  const navigateTo = useNavigateTo()
  const resolveAsset = useAtomValue(assetResolver)
  const onBlockMenu = useAtomSet(blockMenu)
  const vim = useAtomValue(vimMode)
  const updateSidebar = useAtomSet(rightSidebar)
  const openPage = (title: string, sidebar: boolean) => {
    const name = normalizePageName(title)
    if (sidebar) updateSidebar({ _tag: "Open", item: { _tag: "Page", name } })
    else void navigate({ to: "/page/$name", params: { name } })
  }
  return (
    <div className="seqno-board-view">
      <Board
        page={page}
        focus={zoom}
        outliner={{ onNavigate: navigateTo, editor: EditorSlot, resolveAsset, onBlockMenu, vim }}
        resolveAsset={resolveAsset}
        openPage={openPage}
        onRenamed={(name) => void navigate({ to: "/page/$name", params: { name }, replace: true })}
      />
    </div>
  )
}
