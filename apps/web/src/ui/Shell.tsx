import { useAtom, useAtomValue } from "@effect/atom-react"
import { Link, Outlet } from "@tanstack/react-router"
import { Cause } from "effect"
import { AsyncResult } from "effect/reactivity"
import { favorites, openGraph, rightSidebarOpen } from "../atoms.ts"
import { OpenGraphScreen } from "./OpenGraphScreen.tsx"

const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

const LeftSidebar = ({ graph }: { readonly graph: string }) => {
  const starred = useAtomValue(favorites)
  return (
    <aside className="left-sidebar">
      <div className="graph-name">{graph}</div>
      <nav className="nav">
        <Link to="/" activeOptions={{ exact: true }}>
          Journals
        </Link>
        <Link to="/all-pages">All pages</Link>
        <Link to="/search" search={{}}>
          Search
        </Link>
      </nav>
      <section className="favorites">
        <h2>Favorites</h2>
        {starred.length === 0 ? (
          <p className="hint">Star a page to keep it here.</p>
        ) : (
          starred.map((page) => (
            <Link key={page.id} to="/page/$name" params={{ name: page.name }}>
              {page.title}
            </Link>
          ))
        )}
      </section>
    </aside>
  )
}

const RightSidebar = () => (
  <aside className="right-sidebar">
    <h2>Linked references</h2>
    <p className="hint">Backlinks and block references arrive with the SQLite index.</p>
  </aside>
)

const Layout = ({ graph }: { readonly graph: string }) => {
  const [rightOpen, setRightOpen] = useAtom(rightSidebarOpen)
  return (
    <div className="app" data-right-open={rightOpen}>
      <LeftSidebar graph={graph} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="ghost" onClick={() => setRightOpen(!rightOpen)}>
            {rightOpen ? "Hide sidebar" : "Show sidebar"}
          </button>
        </header>
        <main className="main-column">
          <Outlet />
        </main>
      </div>
      {rightOpen ? <RightSidebar /> : null}
    </div>
  )
}

export const Shell = () =>
  AsyncResult.match(useAtomValue(openGraph), {
    onInitial: () => <OpenGraphScreen problem={null} />,
    onFailure: (failure) => <OpenGraphScreen problem={problemOf(failure.cause)} />,
    onSuccess: (opened) => <Layout graph={opened.value.graph} />,
  })
