import { useAtomValue } from "@effect/atom-react"
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { BlockId } from "@seqno/domain"
import { graphLocked } from "./atoms.ts"
import { GraphInUse } from "./ui/pages/GraphInUse.tsx"
import { AllGraphsRoute, AllPages, Journals, PageRoute } from "./ui/routes.tsx"
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

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Journals }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/page/$name",
    validateSearch: Schema.toStandardSchemaV1(PageParams),
    component: PageRoute,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/all-pages", component: AllPages }),
  createRoute({ getParentRoute: () => rootRoute, path: "/graphs", component: AllGraphsRoute }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/search",
    validateSearch: Schema.toStandardSchemaV1(SearchParams),
    component: Journals,
  }),
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
