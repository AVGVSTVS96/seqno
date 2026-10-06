import { useAtomValue } from "@effect/atom-react"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { AsyncResult } from "effect/reactivity"
import { allPages, journals, search } from "../atoms.ts"
import { PageByName, PageView } from "./PageView.tsx"

export const Journals = () => {
  const days = useAtomValue(journals)
  return (
    <div className="journals">
      {days.length === 0 ? <p className="hint">No journal pages yet.</p> : null}
      {days.map((page) => (
        <PageView key={page.id} page={page} />
      ))}
    </div>
  )
}

const pageRoute = getRouteApi("/page/$name")

export const PageRoute = () => {
  const { name } = pageRoute.useParams()
  return <PageByName name={name} />
}

export const AllPages = () => {
  const everyPage = useAtomValue(allPages)
  return (
    <div className="all-pages">
      <h1>All pages</h1>
      <ul>
        {everyPage.map((page) => (
          <li key={page.id}>
            <Link to="/page/$name" params={{ name: page.name }}>
              {page.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const BlockResults = ({ query }: { readonly query: string }) => {
  const everyPage = useAtomValue(allPages)
  const titles = new Map(everyPage.map((page) => [page.id, page]))
  return AsyncResult.match(useAtomValue(search(query)), {
    onInitial: () => <p className="hint">Searching…</p>,
    onFailure: () => <p className="problem">The search could not run.</p>,
    onSuccess: (result) =>
      result.value._tag === "BlockRows" ? (
        <ul className="results">
          {result.value.blocks.map((found) => {
            const page = titles.get(found.pageId)
            return (
              <li key={found.id}>
                {page === undefined ? null : (
                  <Link to="/page/$name" params={{ name: page.name }}>
                    {page.title}
                  </Link>
                )}
                <span>{found.text}</span>
              </li>
            )
          })}
        </ul>
      ) : null,
  })
}

const searchRoute = getRouteApi("/search")

export const Search = () => {
  const { q } = searchRoute.useSearch()
  const query = q ?? ""
  const navigate = useNavigate()
  const everyPage = useAtomValue(allPages)
  const needle = query.trim().toLowerCase()
  const pageHits = needle.length === 0 ? [] : everyPage.filter((page) => page.name.includes(needle))
  return (
    <div className="search">
      <input
        type="search"
        aria-label="Search"
        placeholder="Search pages and blocks"
        autoFocus
        defaultValue={query}
        onChange={(event) =>
          navigate({ to: "/search", search: { q: event.currentTarget.value }, replace: true })
        }
      />
      {pageHits.length === 0 ? null : (
        <ul className="results">
          {pageHits.map((page) => (
            <li key={page.id}>
              <Link to="/page/$name" params={{ name: page.name }}>
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {needle.length === 0 ? null : <BlockResults query={needle} />}
    </div>
  )
}
