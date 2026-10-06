import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { Schema } from "effect"
import { Shell } from "./ui/Shell.tsx"
import { AllPages, Journals, PageRoute, Search } from "./ui/routes.tsx"

const SearchParams = Schema.Struct({ q: Schema.optionalKey(Schema.String) })

const rootRoute = createRootRoute({ component: Shell })

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Journals }),
  createRoute({ getParentRoute: () => rootRoute, path: "/page/$name", component: PageRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/all-pages", component: AllPages }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/search",
    validateSearch: Schema.toStandardSchemaV1(SearchParams),
    component: Search,
  }),
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
