import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useContext } from "react"
import { AsyncResult } from "effect/reactivity"
import { useNavigate } from "@tanstack/react-router"
import { normalizePageName } from "@seqno/domain"
import type { BlockId, Page } from "@seqno/domain"
import { Board } from "@seqno/whiteboard"
import { assetResolver, rightSidebar } from "../../atoms.ts"
import { saveAssetFiles } from "../assets.ts"
import { EditorSlot } from "../EditorSlot.tsx"
import { exported } from "../shell/Export.tsx"
import { blockMenu } from "../shell/BlockMenu.tsx"
import { vimMode } from "../shell/state.ts"
import { pageStats } from "./atoms.ts"
import { useNavigateTo } from "./navigation.ts"
import { onboardedWhiteboard, onboardingBoard } from "./onboarding.ts"
import { PagesStyle } from "./PagesStyle.tsx"
import { References } from "./References.tsx"

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
  const setExported = useAtomSet(exported)
  const registry = useContext(RegistryContext)
  const onboarding = useAtomValue(onboardingBoard) === page.id

  const references = AsyncResult.getOrElse(
    AsyncResult.map(
      useAtomValue(pageStats),
      (stats) => stats.find((stat) => stat.pageId === page.id)?.backlinks ?? 0,
    ),
    () => 0,
  )

  const openPage = (title: string, sidebar: boolean) => {
    const name = normalizePageName(title)

    if (sidebar) {
      updateSidebar({ _tag: "Open", item: { _tag: "Page", name } })
    } else {
      void navigate({ to: "/page/$name", params: { name } })
    }
  }

  return (
    <div
      className="seqno-board-view"
      ref={(node) => {
        if (node !== null && registry.get(onboardingBoard) === null) {
          registry.set(onboardedWhiteboard, true)
        }
      }}
    >
      <PagesStyle />
      {onboarding ? (
        <div className="seqno-board-onboarding" role="status">
          <svg
            className="seqno-board-onboarding-spinner"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              opacity="0.75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading onboarding whiteboard ...</span>
        </div>
      ) : null}
      <Board
        page={page}
        focus={zoom}
        outliner={{ onNavigate: navigateTo, editor: EditorSlot, resolveAsset, onBlockMenu, vim }}
        resolveAsset={resolveAsset}
        saveFiles={async (files) => await saveAssetFiles(registry, files)}
        openPage={openPage}
        references={references}
        referencesPanel={<References page={page} unlinked={false} />}
        onRenamed={(name) => void navigate({ to: "/page/$name", params: { name }, replace: true })}
        onExport={(ids) => {
          setExported({
            name: page.name,
            target: { _tag: "Page", pageId: page.id },
            pages: [page.id],
            shapes: ids,
          })
        }}
      />
    </div>
  )
}
