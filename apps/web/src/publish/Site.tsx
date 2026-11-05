import { logseq } from "@seqno/dom"
import { useAtom, useAtomValue } from "@effect/atom-react"
import {
  IconArrowDown,
  IconArrowUp,
  IconCalendar,
  IconCaretRightFilled,
  IconFile,
  IconFiles,
  IconMenu2,
  IconSearch,
  IconTable,
} from "@tabler/icons-react"
import { Match } from "effect"
import { Atom } from "effect/reactivity"
import { Fragment, useId, useState } from "react"
import type { ReactNode } from "react"
import { normalizePageName } from "@seqno/domain"
import type { Block, BlockId, Page, PageId } from "@seqno/domain"
import type { Published, PublishedName, PublishedReference } from "@seqno/export"
import {
  NestedLists,
  Outliner,
  PageDialects,
  PropertySettings,
  PropertyValue,
  ScrollContent,
} from "@seqno/outliner"
import type { Navigate, NavigationTarget } from "@seqno/outliner"
import pagesCss from "../ui/pages/pages.css?inline"
import shellCss from "../ui/shell/shell.css?inline"
import appCss from "../styles.css?inline"
import themeCss from "../theme.css?inline"
import {
  crumbLabel,
  groupByPage,
  listValues,
  outermost,
  pageRows,
  timestamp,
  trailOf,
  visibleProps,
  visibleRows,
} from "../ui/pages/model.ts"
import type { SortColumn, TableSort } from "../ui/pages/model.ts"
import siteCss from "./site.css?inline"

export type Route =
  | { readonly _tag: "Home" }
  | { readonly _tag: "AllPages" }
  | { readonly _tag: "Page"; readonly name: string }

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

export const routeOf = (hash: string): Route => {
  const path = hash.replace(/^#\/?/u, "")

  if (path === "all-pages") {
    return { _tag: "AllPages" }
  }

  if (path.startsWith("page/")) {
    return { _tag: "Page", name: decoded(path.slice(5)) }
  }

  return { _tag: "Home" }
}

export const hrefOf = (route: Route) =>
  Match.valueTags(route, {
    Home: () => "#/",
    AllPages: () => "#/all-pages",
    Page: ({ name }) => `#/page/${encodeURIComponent(name)}`,
  })

const hash = Atom.make((get) => {
  const changed = () => {
    get.setSelf(location.hash)
  }

  addEventListener("hashchange", changed)
  get.addFinalizer(() => {
    removeEventListener("hashchange", changed)
  })

  return location.hash
}).pipe(Atom.keepAlive)

const go = (route: Route) => {
  location.hash = hrefOf(route)
}

const navigate: Navigate = (target: NavigationTarget) => {
  Match.valueTags(target, {
    Journals: () => {
      go({ _tag: "Home" })
    },
    Page: ({ name }) => {
      go({ _tag: "Page", name: normalizePageName(name) })
    },
    SidebarPage: ({ name }) => {
      go({ _tag: "Page", name: normalizePageName(name) })
    },
    Zoom: ({ blockId }) => {
      if (blockId !== null) {
        go({ _tag: "Page", name: blockId })
      }
    },
    SidebarBlock: ({ blockId }) => {
      go({ _tag: "Page", name: blockId })
    },
  })
}

interface Site {
  readonly data: Published
  readonly resolveAsset: (path: string) => string | undefined
  readonly byName: ReadonlyMap<string, Page>
  readonly byId: ReadonlyMap<PageId, Page>
  readonly blocks: ReadonlyMap<string, Block>
  readonly referenced: ReadonlyMap<string, PublishedName>
}

const siteOf = (data: Published): Site => {
  const byName = new Map<string, Page>()

  for (const { page } of data.pages) {
    byName.set(page.name, page)
  }

  for (const { page } of data.pages) {
    for (const alias of listValues(page.props["alias"] ?? "")) {
      if (!byName.has(normalizePageName(alias))) {
        byName.set(normalizePageName(alias), page)
      }
    }
  }

  const blocks = new Map<string, Block>()

  for (const { blocks: each } of data.pages) {
    for (const block of each) {
      blocks.set(block.id, block)
      const written = block.props["id"]?.toLowerCase()

      if (written !== undefined) {
        blocks.set(written, block)
      }
    }
  }

  return {
    data,
    resolveAsset: (path) => {
      const local = /^(?:\.{1,2}\/|\/)*assets\/(.+)$/u.exec(path)?.[1]

      return local === undefined ? undefined : `assets/${local}`
    },
    byName,
    byId: new Map(data.pages.map(({ page }) => [page.id, page])),
    blocks,
    referenced: new Map(data.referenced.map((name) => [name.name, name])),
  }
}

const PageLink = ({
  name,
  title,
  className,
}: {
  readonly name: string
  readonly title: string
  readonly className: string
}) => (
  <a href={hrefOf({ _tag: "Page", name })} className={className}>
    {title}
  </a>
)

const Fold = ({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) => (
  <button
    type="button"
    className="seqno-fold"
    data-open={open}
    tabIndex={-1}
    aria-hidden
    onClick={onToggle}
  >
    <IconCaretRightFilled size={16} />
  </button>
)

const outline = (site: Site, pageId: PageId, zoom: BlockId | null) => (
  <Outliner
    pageId={pageId}
    zoom={zoom}
    onNavigate={navigate}
    resolveAsset={site.resolveAsset}
    readOnly
  />
)

const ReferenceGroup = ({
  site,
  page,
  blockIds,
}: {
  readonly site: Site
  readonly page: Page
  readonly blockIds: readonly BlockId[]
}) => {
  const [open, setOpen] = useState(true)
  const blocks = site.data.pages.find((entry) => entry.page.id === page.id)?.blocks ?? []
  const trail = trailOf(blocks)

  return (
    <section className="seqno-references-group" aria-label={page.title}>
      <div className="seqno-references-head" data-open={open}>
        <Fold
          open={open}
          onToggle={() => {
            setOpen(!open)
          }}
        />
        <PageLink name={page.name} title={page.title} className="seqno-references-page" />
      </div>
      {open ? (
        <div className="seqno-references-blocks">
          {outermost(blockIds, trail).map((blockId) => {
            const parents = trail(blockId)

            return (
              <div key={blockId} className="seqno-reference">
                {parents.length === 0 ? null : (
                  <nav className="seqno-reference-crumbs" aria-label="Parent blocks">
                    {parents.map((parent, at) => (
                      <Fragment key={parent.id}>
                        {at === 0 ? null : (
                          <span className="seqno-reference-crumbs-separator" aria-hidden>
                            /
                          </span>
                        )}
                        <a href={hrefOf({ _tag: "Page", name: parent.id })}>
                          {crumbLabel(parent.text)}
                        </a>
                      </Fragment>
                    ))}
                  </nav>
                )}
                {outline(site, page.id, blockId)}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

const LinkedReferences = ({
  site,
  references,
}: {
  readonly site: Site
  readonly references: readonly PublishedReference[]
}) => {
  const [open, setOpen] = useState(true)
  const title = useId()

  if (references.length === 0) {
    return null
  }

  return (
    <div className="seqno-page-references">
      <div>
        <section className="seqno-references" aria-labelledby={title}>
          <div className="seqno-references-head" data-open={open}>
            <Fold
              open={open}
              onToggle={() => {
                setOpen(!open)
              }}
            />
            <h2 className="seqno-references-title">
              <button
                id={title}
                type="button"
                aria-expanded={open}
                onClick={() => {
                  setOpen(!open)
                }}
              >
                Linked references
                <span className="seqno-references-count">{references.length}</span>
              </button>
            </h2>
          </div>
          {open ? (
            <div className="seqno-references-body">
              {groupByPage(references).flatMap((group) => {
                const page = site.byId.get(group.pageId)

                return page === undefined
                  ? []
                  : [
                      <ReferenceGroup
                        key={group.pageId}
                        site={site}
                        page={page}
                        blockIds={group.blockIds}
                      />,
                    ]
              })}
            </div>
          ) : null}
        </section>
      </div>
      <div />
    </div>
  )
}

const Properties = ({ page }: { readonly page: Page }) => {
  const props = visibleProps(page.props)

  return props.length === 0 ? null : (
    <div className="seqno-page-properties">
      <div className="seqno-page-properties-control" aria-hidden>
        <span className="seqno-page-properties-bullet" />
      </div>
      <dl className="seqno-properties" aria-label="Page properties">
        {props.map(([key, value]) => (
          <div key={key} className="seqno-property">
            <dt>
              <PageLink name={normalizePageName(key)} title={key} className="seqno-property-key" />
            </dt>
            <dd>
              <PropertyValue name={key} value={value} onNavigate={navigate} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const PageView = ({
  site,
  page,
  inJournals,
}: {
  readonly site: Site
  readonly page: Page
  readonly inJournals?: boolean
}) => {
  const heading = useId()

  return (
    <div className="seqno-page">
      <article aria-labelledby={heading}>
        <h1 id={heading} className="seqno-page-title" data-editable={false}>
          {inJournals === true ? (
            <PageLink name={page.name} title={page.title} className="seqno-page-title-link" />
          ) : (
            <span className="seqno-page-title-text">{page.title}</span>
          )}
        </h1>
        <div className="seqno-page-blocks">
          <Properties page={page} />
          {outline(site, page.id, null)}
        </div>
      </article>
      <LinkedReferences site={site} references={site.data.references[page.name] ?? []} />
    </div>
  )
}

const ZoomView = ({ site, block }: { readonly site: Site; readonly block: Block }) => {
  const page = site.byId.get(block.pageId)

  return (
    <div className="seqno-page" data-zoomed>
      {page === undefined ? null : <title>{crumbLabel(block.text) || page.title}</title>}
      <article aria-label={page?.title ?? ""}>
        <div className="seqno-page-blocks">{outline(site, block.pageId, block.id)}</div>
      </article>
    </div>
  )
}

const Unpublished = ({ site, name }: { readonly site: Site; readonly name: string }) => {
  const title = site.referenced.get(name)?.title ?? name

  return (
    <div className="seqno-page">
      <title>{title}</title>
      <article aria-label={title}>
        <h1 className="seqno-page-title" data-editable={false}>
          {title}
        </h1>
        <p className="site-unpublished">This page isn&apos;t published.</p>
      </article>
      <LinkedReferences site={site} references={site.data.references[name] ?? []} />
    </div>
  )
}

const PageRoute = ({ site, name }: { readonly site: Site; readonly name: string }) => {
  const page = site.byName.get(normalizePageName(name))

  if (page !== undefined) {
    return (
      <>
        <title>{page.title}</title>
        <PageView key={page.id} site={site} page={page} />
      </>
    )
  }

  const block = site.blocks.get(name.toLowerCase())

  if (block !== undefined) {
    return <ZoomView key={block.id} site={site} block={block} />
  }

  return <Unpublished site={site} name={normalizePageName(name)} />
}

const journalsOf = (site: Site) =>
  site.data.pages
    .map(({ page }) => page)
    .filter((page) => page.journalDay !== null)
    .toSorted((left, right) => (right.journalDay ?? 0) - (left.journalDay ?? 0))

const Journals = ({ site }: { readonly site: Site }) => (
  <div className="seqno-journals">
    <title>{site.data.graph}</title>
    <NestedLists>
      {journalsOf(site).map((page) => (
        <div key={page.id} className="seqno-journal">
          <PageView site={site} page={page} inJournals />
        </div>
      ))}
    </NestedLists>
  </div>
)

const columns: ReadonlyArray<readonly [SortColumn, string]> = [
  ["title", "Page name"],
  ["backlinks", "Backlinks"],
  ["created", "Created At"],
  ["updated", "Updated At"],
]

const AllPages = ({ site }: { readonly site: Site }) => {
  const [sort, setSort] = useState<TableSort>({ column: "updated", descending: true })
  const [filter, setFilter] = useState("")

  const rows = visibleRows(
    pageRows(
      site.data.pages.map(({ page }) => page),
      site.data.pages.map(({ page, created, updated }) => ({
        pageId: page.id,
        backlinks: new Set((site.data.references[page.name] ?? []).map((ref) => ref.blockId)).size,
        created,
        updated,
      })),
    ),
    { sort, filter, journals: true },
  )

  return (
    <div {...logseq("seqno-all-pages")}>
      <title>All pages</title>
      <div className="seqno-view-head">
        <h1 className="seqno-view-title">
          <IconTable size={15} aria-hidden />
          All
          <span className="seqno-view-count">{rows.length}</span>
        </h1>
        <div {...logseq("seqno-view-actions")}>
          <div {...logseq("seqno-view-filter")}>
            <input
              {...logseq("seqno-view-filter-input")}
              type="search"
              aria-label="Search pages"
              placeholder="Type to search"
              value={filter}
              onChange={(event) => {
                setFilter(event.currentTarget.value)
              }}
            />
          </div>
        </div>
      </div>
      <div className="seqno-table-scroll">
        <table {...logseq("seqno-table")} aria-label="All pages">
          <thead>
            <tr>
              <th className="seqno-table-gutter" aria-hidden />
              {columns.map(([column, label]) => (
                <th
                  key={column}
                  scope="col"
                  data-column={column}
                  aria-sort={
                    sort.column === column
                      ? sort.descending
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort({
                        column,
                        descending: sort.column === column ? !sort.descending : column !== "title",
                      })
                    }}
                  >
                    {label}
                    {sort.column === column ? (
                      sort.descending ? (
                        <IconArrowDown size={18} aria-hidden />
                      ) : (
                        <IconArrowUp size={18} aria-hidden />
                      )
                    ) : null}
                  </button>
                </th>
              ))}
              <th className="seqno-table-rest" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ page, backlinks, created, updated }) => (
              <tr key={page.name}>
                <td className="seqno-table-gutter" aria-hidden />
                <td>
                  <PageLink name={page.name} title={page.title} className="seqno-table-page" />
                </td>
                <td>{backlinks}</td>
                <td>{timestamp(created)}</td>
                <td>{timestamp(updated)}</td>
                <td className="seqno-table-rest" aria-hidden />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const Search = ({ site, onClose }: { readonly site: Site; readonly onClose: () => void }) => {
  const [text, setText] = useState("")
  const needle = text.trim().toLowerCase()

  const pages =
    needle === ""
      ? []
      : site.data.pages
          .map(({ page }) => page)
          .filter((page) => page.title.toLowerCase().includes(needle))
          .slice(0, 8)

  const blocks =
    needle === ""
      ? []
      : site.data.pages
          .flatMap(({ blocks: each }) => each)
          .filter((block) => block.text.toLowerCase().includes(needle))
          .slice(0, 12)

  const choose = (name: string) => {
    onClose()
    go({ _tag: "Page", name })
  }

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop light dismiss; the native dialog closes on Escape and closedby has no Safari support
    <dialog
      className="dialog site-search"
      aria-label="Search"
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) {
          dialog.showModal()
        }
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          event.currentTarget.close()
        }
      }}
    >
      <input
        type="search"
        className="site-search-input"
        aria-label="Search"
        placeholder="Search for a page or block"
        autoFocus
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          const first = pages[0]?.name ?? blocks[0]?.id

          if (event.key === "Enter" && first !== undefined) {
            choose(first)
          }
        }}
      />
      {pages.length + blocks.length === 0 ? null : (
        <ul className="site-search-results">
          {pages.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => {
                  choose(page.name)
                }}
              >
                <IconFile size={16} aria-hidden />
                {page.title}
              </button>
            </li>
          ))}
          {blocks.map((block) => (
            <li key={block.id}>
              <button
                type="button"
                onClick={() => {
                  choose(block.id)
                }}
              >
                <span className="site-search-block">{crumbLabel(block.text)}</span>
                <span className="site-search-page">{site.byId.get(block.pageId)?.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  )
}

const NavItem = ({
  route,
  current,
  icon,
  label,
}: {
  readonly route: Route
  readonly current: Route
  readonly icon: ReactNode
  readonly label: string
}) => (
  <a
    href={hrefOf(route)}
    {...logseq("nav-item")}
    {...(route._tag === current._tag ? { "aria-current": "page" as const } : {})}
  >
    {icon}
    <span className="nav-item-label">{label}</span>
  </a>
)

const Content = ({ site, route }: { readonly site: Site; readonly route: Route }) => {
  switch (route._tag) {
    case "Home": {
      return journalsOf(site).length > 0 ? <Journals site={site} /> : <AllPages site={site} />
    }

    case "AllPages": {
      return <AllPages site={site} />
    }

    case "Page": {
      return <PageRoute site={site} name={route.name} />
    }
  }
}

const leftOpen = Atom.make(matchMedia("(min-width: 1024px)").matches).pipe(Atom.keepAlive)

export const SiteView = ({ data }: { readonly data: Published }) => {
  const [site] = useState(() => siteOf(data))

  const [org] = useState(
    () => new Set(data.pages.flatMap(({ page }) => (page.format === "org" ? [page.id] : []))),
  )

  const [properties] = useState(() => ({
    listKeys: new Set(data.listKeys),
    unparsedKeys: new Set<string>(),
  }))

  const route = routeOf(useAtomValue(hash))
  const [open, setOpen] = useAtom(leftOpen)
  const [searching, setSearching] = useState(false)
  const journals = journalsOf(site).length > 0

  return (
    <PropertySettings value={properties}>
      <PageDialects value={(pageId) => (org.has(pageId) ? "org" : "markdown")}>
        <style href="seqno/theme" precedence="theme">
          {themeCss}
        </style>
        <style href="seqno/app" precedence="app">
          {appCss}
        </style>
        <style href="seqno/shell" precedence="app">
          {shellCss}
        </style>
        <style href="seqno/pages" precedence="pages">
          {pagesCss}
        </style>
        <style href="seqno/site" precedence="pages">
          {siteCss}
        </style>
        <div
          className="app"
          data-left-open={open}
          data-right-open={false}
          data-wide={false}
          style={{ "--left-sidebar-width": "240px", "--right-sidebar-width": "0vw" }}
        >
          <div className="left-container">
            <header {...logseq("head")}>
              <div className="head-left">
                <button
                  type="button"
                  aria-label="Toggle left sidebar"
                  className="icon-button"
                  aria-expanded={open}
                  onClick={() => {
                    setOpen(!open)
                  }}
                >
                  <IconMenu2 size={20} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Search"
                  className="icon-button"
                  onClick={() => {
                    setSearching(true)
                  }}
                >
                  <IconSearch size={20} aria-hidden />
                </button>
              </div>
              <div className="head-right" />
            </header>
            <div className="main-container">
              <aside
                className="left-sidebar"
                aria-label="Left sidebar"
                data-open={open}
                inert={!open}
                aria-hidden={!open}
              >
                <div {...logseq("left-sidebar-inner")}>
                  <div className="left-sidebar-wrap">
                    <div className="left-sidebar-header">
                      <div className="graph-switcher">
                        <a href="#/" className="graph-switcher-trigger">
                          <strong className="graph-name">{site.data.graph}</strong>
                        </a>
                      </div>
                      <section className="sidebar-group" aria-label="Navigations">
                        <nav className="sidebar-nav" aria-label="Navigations">
                          {journals ? (
                            <NavItem
                              route={{ _tag: "Home" }}
                              current={route}
                              icon={
                                <IconCalendar className="nav-item-icon" size={16} aria-hidden />
                              }
                              label="Journals"
                            />
                          ) : null}
                          <NavItem
                            route={{ _tag: "AllPages" }}
                            current={
                              journals
                                ? route
                                : route._tag === "Home"
                                  ? { _tag: "AllPages" }
                                  : route
                            }
                            icon={<IconFiles className="nav-item-icon" size={16} aria-hidden />}
                            label="Pages"
                          />
                        </nav>
                      </section>
                    </div>
                  </div>
                </div>
              </aside>
              <main className="main-content-container">
                <ScrollContent className="main-content">
                  <Content key={hrefOf(route)} site={site} route={route} />
                </ScrollContent>
              </main>
            </div>
          </div>
        </div>
        {searching ? (
          <Search
            site={site}
            onClose={() => {
              setSearching(false)
            }}
          />
        ) : null}
      </PageDialects>
    </PropertySettings>
  )
}
