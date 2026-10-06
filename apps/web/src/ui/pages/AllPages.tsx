import { useAtom, useAtomValue } from "@effect/atom-react"
import {
  IconArrowDown,
  IconArrowUp,
  IconCalendar,
  IconCalendarOff,
  IconSearch,
  IconTable,
  IconX,
} from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { normalizePageName } from "@seqno/domain"
import type { PageStat } from "@seqno/rpc"
import { allPages } from "../../atoms.ts"
import { PagesStyle } from "../PageView.tsx"
import { allPagesJournals, allPagesSort, pageStats } from "./atoms.ts"
import { listValues, pageRows, timestamp, visibleRows, type SortColumn } from "./model.ts"
import { PageLink } from "./PageLink.tsx"

const columns: ReadonlyArray<readonly [SortColumn | "tags", string]> = [
  ["title", "Page name"],
  ["backlinks", "Backlinks"],
  ["tags", "Tags"],
  ["created", "Created At"],
  ["updated", "Updated At"],
]

const noStats: ReadonlyArray<PageStat> = []

const Filter = ({
  text,
  onText,
}: {
  readonly text: string | null
  readonly onText: (text: string | null) => void
}) =>
  text === null ? (
    <button
      type="button"
      className="seqno-view-action"
      aria-label="Search pages"
      onClick={() => onText("")}
    >
      <IconSearch size={18} aria-hidden />
    </button>
  ) : (
    <div className="seqno-view-filter">
      <input
        type="search"
        aria-label="Search pages"
        placeholder="Type to search"
        value={text}
        autoFocus
        onChange={(event) => onText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onText(null)
        }}
      />
      <button
        type="button"
        className="seqno-view-action"
        aria-label="Close search"
        onClick={() => onText(null)}
      >
        <IconX size={18} aria-hidden />
      </button>
    </div>
  )

export const AllPages = () => {
  const everyPage = useAtomValue(allPages)
  const stats = AsyncResult.getOrElse(useAtomValue(pageStats), () => noStats)
  const [sort, setSort] = useAtom(allPagesSort)
  const [journals, setJournals] = useAtom(allPagesJournals)
  const [filter, setFilter] = useState<string | null>(null)
  const rows = visibleRows(pageRows(everyPage, stats), {
    sort,
    filter: filter ?? "",
    journals,
  })
  const sortBy = (column: SortColumn) =>
    setSort({
      column,
      descending: sort.column === column ? !sort.descending : column !== "title",
    })
  return (
    <div className="seqno-all-pages">
      <PagesStyle />
      <div className="seqno-view-head">
        <h1 className="seqno-view-title">
          <IconTable size={15} aria-hidden />
          All
          <span className="seqno-view-count">{rows.length}</span>
        </h1>
        <div className="seqno-view-actions">
          <Filter text={filter} onText={setFilter} />
          <button
            type="button"
            className="seqno-view-action"
            aria-label="Include journals"
            title={journals ? "Hide journals" : "Show journals"}
            aria-pressed={journals}
            onClick={() => setJournals(!journals)}
          >
            {journals ? (
              <IconCalendar size={18} aria-hidden />
            ) : (
              <IconCalendarOff size={18} aria-hidden />
            )}
          </button>
        </div>
      </div>
      <div className="seqno-table-scroll">
        <table className="seqno-table" aria-label="All pages">
          <thead>
            <tr>
              <th className="seqno-table-gutter" aria-hidden />
              {columns.map(([column, label]) => (
                <th
                  key={column}
                  scope="col"
                  data-column={column}
                  aria-sort={
                    sort.column !== column
                      ? undefined
                      : sort.descending
                        ? "descending"
                        : "ascending"
                  }
                >
                  {column === "tags" ? (
                    <span className="seqno-table-label">{label}</span>
                  ) : (
                    <button type="button" onClick={() => sortBy(column)}>
                      {label}
                      {sort.column !== column ? null : sort.descending ? (
                        <IconArrowDown size={18} aria-hidden />
                      ) : (
                        <IconArrowUp size={18} aria-hidden />
                      )}
                    </button>
                  )}
                </th>
              ))}
              <th className="seqno-table-rest" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ page, backlinks, created, updated }) => (
              <tr key={page.id}>
                <td className="seqno-table-gutter" />
                <td>
                  <PageLink page={page} className="seqno-table-page" />
                </td>
                <td>{backlinks}</td>
                <td>
                  {listValues(page.props["tags"] ?? "").map((tag) => (
                    <PageLink
                      key={tag}
                      page={{ name: normalizePageName(tag), title: tag }}
                      className="seqno-table-tag"
                    >
                      #{tag}
                    </PageLink>
                  ))}
                </td>
                <td>{timestamp(created)}</td>
                <td>{timestamp(updated)}</td>
                <td className="seqno-table-rest" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
