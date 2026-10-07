import { use, useState, type ReactNode } from "react"
import { useAtomValue } from "@effect/atom-react"
import {
  IconCaretRightFilled,
  IconChevronRight,
  IconPlus,
  IconSearch,
  IconTable,
} from "@tabler/icons-react"
import { Cause } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Block, Page, PageId } from "@seqno/domain"
import type { QueryResult } from "@seqno/rpc"
import { plainText } from "@seqno/syntax"
import { pageTreeAtom, queryAtom } from "./core.ts"
import { Inlines } from "./Inline.tsx"
import { clickOnEnter, contentOf, RenderContext, toPage } from "./render.ts"

type Sexp = string | ReadonlyArray<Sexp>

export type Clause =
  | { readonly _tag: "Chip"; readonly label: string }
  | { readonly _tag: "Group"; readonly op: string; readonly clauses: ReadonlyArray<Clause> }

const token = /"[^"]*"|\[\[.*?\]\]|[()]|[^\s()"]+/g

const sexpsOf = (tokens: ReadonlyArray<string>): ReadonlyArray<Sexp> => {
  const stack: Array<Array<Sexp>> = [[]]
  for (const part of tokens) {
    if (part === "(") stack.push([])
    else if (part === ")" && stack.length > 1) {
      const done = stack.pop() ?? []
      stack.at(-1)?.push(done)
    } else if (part !== ")") stack.at(-1)?.push(part)
  }
  return stack[0] ?? []
}

const unquoted = (atom: string) => atom.replace(/^"(.*)"$/, "$1")

const written = (sexp: Sexp): string =>
  typeof sexp === "string" ? unquoted(sexp) : `(${sexp.map(written).join(" ")})`

const connectives = new Set(["and", "or", "not"])

const chip = (label: string): Clause => ({ _tag: "Chip", label })

const clauseOf = (sexp: Sexp): Clause => {
  if (typeof sexp === "string") {
    return chip(sexp.startsWith('"') ? `search: ${unquoted(sexp)}` : sexp)
  }
  const [head, ...args] = sexp
  if (typeof head !== "string" || args.length === 0) return chip(written(sexp))
  if (connectives.has(head)) {
    return { _tag: "Group", op: head.toUpperCase(), clauses: args.map(clauseOf) }
  }
  const values = args.map(written)
  if (head === "property" || head === "page-property") {
    const [key, ...rest] = values
    return chip(rest.length === 0 ? `${key}` : `${key}: ${rest.join(" | ")}`)
  }
  if (head === "page-tags") return chip(values.map((tag) => `#${tag}`).join(" "))
  if (head === "between") return chip(`between: ${values.join(" ~ ")}`)
  return chip(`${head}: ${values.join(" | ")}`)
}

export const queryClauses = (query: string): ReadonlyArray<Clause> =>
  sexpsOf(query.match(token) ?? []).map(clauseOf)

const ClauseView = ({ clause }: { readonly clause: Clause }): ReactNode =>
  clause._tag === "Chip" ? (
    <span className="seqno-query-clause">{clause.label}</span>
  ) : (
    <span className="seqno-query-group-clause">
      <span className="seqno-query-bracket" aria-hidden>
        (
      </span>
      <span className="seqno-query-op">{clause.op}</span>
      {clause.clauses.map((inner, at) => (
        <ClauseView key={at} clause={inner} />
      ))}
      <span className="seqno-query-bracket" aria-hidden>
        )
      </span>
    </span>
  )

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

const results = (count: number) => `${count} ${count === 1 ? "result" : "results"}`

const PageName = ({ page }: { readonly page: Pick<Page, "name" | "title"> }) => {
  const renderer = use(RenderContext)
  return (
    <a
      role="link"
      tabIndex={0}
      className="seqno-query-page"
      onClick={toPage(renderer.navigate, page.name)}
      onKeyDown={clickOnEnter}
    >
      {page.title}
    </a>
  )
}

const trailOf = (byId: ReadonlyMap<string, Block>, block: Block): ReadonlyArray<Block> => {
  const trail: Array<Block> = []
  let parent = block.parentId === null ? undefined : byId.get(block.parentId)
  while (parent !== undefined) {
    trail.unshift(parent)
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
  }
  return trail
}

const Crumbs = ({ trail }: { readonly trail: ReadonlyArray<Block> }) => {
  const renderer = use(RenderContext)
  return trail.length === 0 ? null : (
    <nav className="seqno-query-crumbs" aria-label="Parent blocks">
      {trail.map((parent) => (
        <span key={parent.id} className="seqno-query-crumb">
          <IconChevronRight size={18} stroke={2} aria-hidden />
          <a
            role="link"
            tabIndex={0}
            onKeyDown={clickOnEnter}
            onClick={(event) => {
              event.preventDefault()
              renderer.navigate(
                event.shiftKey
                  ? { _tag: "SidebarBlock", blockId: parent.id }
                  : { _tag: "Zoom", pageId: parent.pageId, blockId: parent.id },
              )
            }}
          >
            {plainText(contentOf(parent.text).title ?? [])}
          </a>
        </span>
      ))}
    </nav>
  )
}

const PageGroup = ({
  pageId,
  blocks,
}: {
  readonly pageId: PageId
  readonly blocks: ReadonlyArray<Block>
}) => {
  const renderer = use(RenderContext)
  const Embed = renderer.Embed
  const [folded, setFolded] = useState(false)
  const tree = AsyncResult.getOrElse(useAtomValue(pageTreeAtom(pageId)), () => null)
  if (tree === null) return null
  const chosen = new Set(blocks.map((block) => block.id))
  const byId = new Map(tree.blocks.map((found) => [found.id, found]))
  const siblings = new Map<string, { trail: ReadonlyArray<Block>; blocks: Array<Block> }>()
  for (const block of blocks) {
    const trail = trailOf(byId, block)
    if (trail.some((parent) => chosen.has(parent.id))) continue
    const key = block.parentId ?? ""
    const group = siblings.get(key) ?? { trail, blocks: [] }
    group.blocks.push(block)
    siblings.set(key, group)
  }
  return (
    <section className="seqno-query-group" aria-label={tree.page.title}>
      <div className="seqno-query-group-head">
        <button
          type="button"
          className="seqno-toggle"
          aria-label={folded ? "Expand" : "Collapse"}
          aria-expanded={!folded}
          data-expanded={!folded}
          onClick={() => setFolded(!folded)}
        >
          <IconCaretRightFilled size={16} aria-hidden />
        </button>
        <PageName page={tree.page} />
      </div>
      {folded
        ? null
        : [...siblings].map(([key, { trail, blocks: shown }]) => (
            <div key={key} className="seqno-query-block">
              <Crumbs trail={trail} />
              {shown.map((block) => (
                <Embed key={block.id} target={{ _tag: "Block", blockId: block.id }} bare />
              ))}
            </div>
          ))}
    </section>
  )
}

const PageCell = ({ pageId }: { readonly pageId: PageId }) => {
  const tree = AsyncResult.getOrElse(useAtomValue(pageTreeAtom(pageId)), () => null)
  return tree === null ? null : <PageName page={tree.page} />
}

const Table = ({
  head,
  children,
}: {
  readonly head: ReadonlyArray<string>
  readonly children: ReactNode
}) => (
  <table className="seqno-query-table">
    <thead>
      <tr>
        {head.map((name) => (
          <th key={name}>{name}</th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
)

const byPage = (blocks: ReadonlyArray<Block>) => {
  const groups = new Map<PageId, Array<Block>>()
  for (const block of blocks) groups.set(block.pageId, [...(groups.get(block.pageId) ?? []), block])
  return [...groups]
}

export const BlockGroups = ({ blocks }: { readonly blocks: ReadonlyArray<Block> }) => (
  <div className="seqno-query-groups">
    {byPage(blocks).map(([pageId, onPage]) => (
      <PageGroup key={pageId} pageId={pageId} blocks={onPage} />
    ))}
  </div>
)

const countOf = (result: QueryResult) =>
  result._tag === "BlockRows" ? result.blocks.length : result.pages.length

const Results = ({ result, table }: { readonly result: QueryResult; readonly table: boolean }) => {
  if (countOf(result) === 0) return <div className="seqno-query-empty">No matched result</div>
  if (result._tag === "PageRows") {
    return (
      <Table head={["page"]}>
        {result.pages.map((page) => (
          <tr key={page.id}>
            <td>
              <PageName page={page} />
            </td>
          </tr>
        ))}
      </Table>
    )
  }
  return table ? (
    <Table head={["block", "page"]}>
      {result.blocks.map((block) => (
        <tr key={block.id}>
          <td>
            <Inlines nodes={contentOf(block.text).title ?? []} />
          </td>
          <td>
            <PageCell pageId={block.pageId} />
          </td>
        </tr>
      ))}
    </Table>
  ) : (
    <BlockGroups blocks={result.blocks} />
  )
}

const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : "This query could not run"
}

const Outcome = ({
  watched,
  table,
}: {
  readonly watched: AsyncResult.AsyncResult<QueryResult, unknown>
  readonly table: boolean
}) =>
  AsyncResult.match(watched, {
    onInitial: () => null,
    onFailure: ({ cause }) => (
      <div className="seqno-query-empty" role="alert">
        {problemOf(cause)}
      </div>
    ),
    onSuccess: ({ value }) => <Results result={value} table={table} />,
  })

export const QueryView = ({ query }: { readonly query: string }) => {
  const [table, setTable] = useState(false)
  const watched = useAtomValue(queryAtom(query))
  const clauses = queryClauses(query)
  const result = AsyncResult.getOrElse(watched, () => null)
  const count = result === null ? 0 : countOf(result)
  return (
    <section className="seqno-query" aria-label="Live query">
      <div className="seqno-query-head">
        <span className="seqno-query-title">
          <IconSearch size={14} stroke={2} aria-hidden />
          <span>{result?._tag === "PageRows" ? "Live query for pages" : "Live query"}</span>
        </span>
        <span className="seqno-query-actions">
          {count === 0 ? null : <span>{results(count)}</span>}
          <button
            type="button"
            className="seqno-query-action"
            aria-label="Show as a table"
            aria-pressed={table}
            onClick={(event) => {
              event.stopPropagation()
              setTable(!table)
            }}
          >
            <IconTable size={18} stroke={2} aria-hidden />
          </button>
        </span>
      </div>
      <div className="seqno-query-builder">
        {clauses.map((clause, at) => (
          <ClauseView key={at} clause={clause} />
        ))}
        <button type="button" className="seqno-query-add" aria-label="Edit the query">
          <IconPlus size={18} stroke={2} aria-hidden />
        </button>
      </div>
      {query === "" ? null : (
        <div
          className="seqno-query-results"
          onClick={stop}
          onDragOver={stop}
          onDrop={stop}
          onKeyDown={stop}
        >
          <Outcome watched={watched} table={table} />
        </div>
      )}
    </section>
  )
}
