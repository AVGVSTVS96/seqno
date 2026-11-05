import { useAtomValue } from "@effect/atom-react"
import { getRouteApi } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { BlockId } from "@seqno/domain"
import { blockAtom } from "@seqno/outliner"
import { journalDate, journalTitle } from "@seqno/editor"
import { assetPageName, hlsPagePrefix } from "@seqno/syntax"
import { pageNamed } from "../atoms.ts"
import { AllGraphs } from "./OpenGraphScreen.tsx"
import { GraphView } from "./graph/GraphView.tsx"
import { PageByName } from "./PageView.tsx"
import { AllPages as AllPagesView } from "./pages/AllPages.tsx"
import { FilePage } from "./pages/FilePage.tsx"
import { Journals as JournalsView } from "./pages/Journals.tsx"
import { Whiteboards as WhiteboardsView } from "./pages/Whiteboards.tsx"

export const appTitle = "seqno"

const pageRoute = getRouteApi("/page/$name")

const fileRoute = getRouteApi("/file/$path")

const ZoomTitle = ({
  blockId,
  fallback,
}: {
  readonly blockId: BlockId
  readonly fallback: string
}) => {
  const text = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(blockAtom(blockId)), (block) => block.text.split("\n")[0] ?? ""),
    () => "",
  )

  return <title>{text.trim() === "" ? fallback : text}</title>
}

const TabTitle = ({ name, zoom }: { readonly name: string; readonly zoom: BlockId | null }) => {
  const title = Option.match(AsyncResult.getOrElse(useAtomValue(pageNamed(name)), Option.none), {
    onNone: () => {
      const day = journalDate(name)

      return day === null ? name : journalTitle(day)
    },
    onSome: (page) =>
      page.title.startsWith(hlsPagePrefix) ? assetPageName(page.title) : page.title,
  })

  return zoom === null ? <title>{title}</title> : <ZoomTitle blockId={zoom} fallback={title} />
}

export const PageRoute = () => {
  const { name } = pageRoute.useParams()
  const { zoom } = pageRoute.useSearch()

  return (
    <>
      <TabTitle name={name} zoom={zoom ?? null} />
      <PageByName name={name} zoom={zoom ?? null} />
    </>
  )
}

export const Journals = () => (
  <>
    <title>{appTitle}</title>
    <JournalsView />
  </>
)

export const AllPages = () => (
  <>
    <title>All pages</title>
    <AllPagesView />
  </>
)

export const WhiteboardsRoute = () => (
  <>
    <title>Whiteboards</title>
    <WhiteboardsView />
  </>
)

export const GraphRoute = () => (
  <>
    <title>Graph view</title>
    <GraphView />
  </>
)

export const AllGraphsRoute = () => (
  <div className="seqno-all-graphs">
    <AllGraphs problem={null} />
  </div>
)

export const FileRoute = () => {
  const { path } = fileRoute.useParams()

  return (
    <>
      <title>{path}</title>
      <FilePage path={path} />
    </>
  )
}
