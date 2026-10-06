import { getRouteApi } from "@tanstack/react-router"
import { PageByName } from "./PageView.tsx"

export { AllPages } from "./pages/AllPages.tsx"
export { Journals } from "./pages/Journals.tsx"

const pageRoute = getRouteApi("/page/$name")

export const PageRoute = () => {
  const { name } = pageRoute.useParams()
  const { zoom } = pageRoute.useSearch()
  return <PageByName name={name} zoom={zoom ?? null} />
}
