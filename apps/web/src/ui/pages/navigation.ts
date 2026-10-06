import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { Match } from "effect"
import { normalizePageName, type BlockId, type Page } from "@seqno/domain"
import type { NavigationTarget } from "@seqno/outliner"
import { allPages, rightSidebar } from "../../atoms.ts"

export const useOpenPage = () => {
  const navigate = useNavigate()
  return (page: Pick<Page, "name">, zoom: BlockId | null = null) =>
    navigate({
      to: "/page/$name",
      params: { name: page.name },
      search: zoom === null ? {} : { zoom },
    })
}

export const useNavigateTo = () => {
  const navigate = useNavigate()
  const open = useOpenPage()
  const updateSidebar = useAtomSet(rightSidebar)
  const known = useAtomValue(allPages)
  return Match.type<NavigationTarget>().pipe(
    Match.tagsExhaustive({
      Journals: () => navigate({ to: "/" }),
      Page: ({ name }) => open({ name: normalizePageName(name) }),
      Zoom: ({ pageId, blockId }) => {
        const page = known.find((candidate) => candidate.id === pageId)
        if (page !== undefined) open(page, blockId)
      },
      SidebarPage: ({ name }) =>
        updateSidebar({ _tag: "Open", item: { _tag: "Page", name: normalizePageName(name) } }),
      SidebarBlock: ({ blockId }) =>
        updateSidebar({ _tag: "Open", item: { _tag: "Block", blockId } }),
    }),
  )
}
