import { useAtomValue } from "@effect/atom-react"
import { getRouteApi } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { BlockId } from "@seqno/domain"
import { blockAtom } from "@seqno/outliner"
import { pageNamed } from "../atoms.ts"
import { AllGraphs } from "./OpenGraphScreen.tsx"
import { PageByName } from "./PageView.tsx"
import { AllPages as AllPagesView } from "./pages/AllPages.tsx"
import { Journals as JournalsView } from "./pages/Journals.tsx"

export const appTitle = "seqno"

const pageRoute = getRouteApi("/page/$name")

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
    onNone: () => name,
    onSome: (page) => page.title,
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

export const AllGraphsRoute = () => (
  <div className="seqno-all-graphs">
    <AllGraphs problem={null} />
  </div>
)
