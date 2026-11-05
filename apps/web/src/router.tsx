import { useAtomValue } from "@effect/atom-react"
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { BlockId } from "@seqno/domain"
import { graphLocked } from "./atoms.ts"
import { GraphInUse } from "./ui/pages/GraphInUse.tsx"
import {
  AllGraphsRoute,
  AllPages,
  FileRoute,
  GraphRoute,
  Journals,
  PageRoute,
  WhiteboardsRoute,
} from "./ui/routes.tsx"
import { SearchPalette } from "./ui/search/SearchPalette.tsx"
import { Shell } from "./ui/Shell.tsx"

const SearchParams = Schema.Struct({ q: Schema.optionalKey(Schema.String) })

const PageParams = Schema.Struct({ zoom: Schema.optionalKey(BlockId) })

const Root = () =>
  Option.match(useAtomValue(graphLocked), {
    onSome: (graph) => <GraphInUse graph={graph} />,
    onNone: () => (
      <>
        <Shell />
        <SearchPalette />
      </>
    ),
  })

const rootRoute = createRootRoute({ component: Root })

const journalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Journals,
})

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/page/$name",
  validateSearch: Schema.toStandardSchemaV1(PageParams),
  component: PageRoute,
})

const allPagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/all-pages",
  component: AllPages,
})

const fileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/file/$path",
  component: FileRoute,
})

const graphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/graph",
  component: GraphRoute,
})

const whiteboardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/whiteboards",
  component: WhiteboardsRoute,
})

const allGraphsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/graphs",
  component: AllGraphsRoute,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: Schema.toStandardSchemaV1(SearchParams),
  component: Journals,
})

const routeTree = rootRoute.addChildren([
  journalsRoute,
  pageRoute,
  allPagesRoute,
  fileRoute,
  graphRoute,
  whiteboardsRoute,
  allGraphsRoute,
  searchRoute,
])

export const router = createRouter({ routeTree, basepath: import.meta.env.BASE_URL })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
