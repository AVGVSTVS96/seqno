import { useAtom, useAtomValue } from "@effect/atom-react"
import { Link, Outlet } from "@tanstack/react-router"
import { Cause } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { BlockId } from "@seqno/domain"
import { blockAtom } from "@seqno/outliner"
import {
  favorites,
  leftSidebarOpen,
  openGraph,
  pages,
  rightSidebar,
  SidebarItem,
  sidebarItemKey,
} from "../atoms.ts"
import { OpenGraphScreen } from "./OpenGraphScreen.tsx"
import { PageByName, PageView } from "./PageView.tsx"

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

const SidebarBlock = ({ blockId }: { readonly blockId: BlockId }) => {
  const known = AsyncResult.getOrElse(useAtomValue(pages), () => [])
  return AsyncResult.match(useAtomValue(blockAtom(blockId)), {
    onInitial: () => <p className="hint">Loading…</p>,
    onFailure: () => <p className="problem">This block could not be loaded.</p>,
    onSuccess: ({ value }) => {
      const page = known.find((candidate) => candidate.id === value.pageId)
      return page === undefined ? null : <PageView page={page} zoom={value.id} />
    },
  })
}

const SidebarEntry = ({ item }: { readonly item: SidebarItem }) =>
  SidebarItem.match(item, {
    Page: ({ name }) => <PageByName name={name} zoom={null} />,
    Block: ({ blockId }) => <SidebarBlock blockId={blockId} />,
  })

const RightSidebar = ({ items }: { readonly items: ReadonlyArray<SidebarItem> }) => (
  <aside className="right-sidebar" aria-label="Right sidebar">
    {items.length === 0 ? (
      <p className="hint">Shift-click a page or block to open it here.</p>
    ) : (
      items.map((item) => <SidebarEntry key={sidebarItemKey(item)} item={item} />)
    )}
  </aside>
)

const Layout = ({ graph }: { readonly graph: string }) => {
  const [sidebar, updateSidebar] = useAtom(rightSidebar)
  const leftOpen = useAtomValue(leftSidebarOpen)
  return (
    <div className="app" data-left-open={leftOpen} data-right-open={sidebar.open}>
      {leftOpen ? <LeftSidebar graph={graph} /> : null}
      <div className="main">
        <header className="topbar">
          <button type="button" className="ghost" onClick={() => updateSidebar({ _tag: "Toggle" })}>
            {sidebar.open ? "Hide sidebar" : "Show sidebar"}
          </button>
        </header>
        <main className="main-column">
          <Outlet />
        </main>
      </div>
      {sidebar.open ? <RightSidebar items={sidebar.items} /> : null}
    </div>
  )
}

export const Shell = () =>
  AsyncResult.match(useAtomValue(openGraph), {
    onInitial: () => <OpenGraphScreen problem={null} />,
    onFailure: (failure) => <OpenGraphScreen problem={problemOf(failure.cause)} />,
    onSuccess: (opened) => <Layout graph={opened.value.graph} />,
  })
