import { useAtomValue } from "@effect/atom-react"
import {
  IconChalkboard,
  IconCirclePlus,
  IconFile,
  IconFileText,
  IconLetterCase,
  IconSearch,
} from "@tabler/icons-react"
import { Effect } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { useState, type ReactNode } from "react"
import { isWhiteboard, normalizePageName, type Block, type Page } from "@seqno/domain"
import { coreRuntime } from "@seqno/outliner"
import { CoreClient } from "@seqno/rpc"

export type Pick =
  | { readonly _tag: "NewBlock"; readonly text: string }
  | { readonly _tag: "NewPage"; readonly title: string }
  | { readonly _tag: "NewWhiteboard"; readonly title: string }
  | { readonly _tag: "Page"; readonly page: Page }
  | { readonly _tag: "Block"; readonly block: Block }

type Filter = "blocks" | "pages" | null

type Option =
  | { readonly _tag: "Pick"; readonly pick: Pick }
  | { readonly _tag: "Filter"; readonly filter: "blocks" | "pages" }

const searchAtom = Atom.family((text: string) =>
  coreRuntime.atom(Effect.flatMap(CoreClient, (core) => core.Search({ text }))),
)

const noHits = { pages: [], blocks: [] }

const Marked = ({ text, query }: { readonly text: string; readonly query: string }) => {
  const at = query === "" ? -1 : text.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  )
}

interface HitsProps {
  readonly query: string
  readonly filter: Filter
  readonly children: (hits: {
    readonly pages: ReadonlyArray<Page>
    readonly blocks: ReadonlyArray<Block>
  }) => ReactNode
}

const Hits = (props: HitsProps) =>
  props.query === "" ? props.children(noHits) : <Searched {...props} />

const Searched = ({ query, filter, children }: HitsProps) => {
  const hits = AsyncResult.getOrElse(useAtomValue(searchAtom(query)), () => noHits)
  return children({
    pages: filter === "blocks" ? [] : hits.pages.slice(0, 50),
    blocks: filter === "pages" ? [] : hits.blocks.slice(0, 50),
  })
}

const optionsFor = (
  query: string,
  filter: Filter,
  pages: ReadonlyArray<Page>,
  blocks: ReadonlyArray<Block>,
  addsBlocks: boolean,
): ReadonlyArray<Option> => {
  const text = query.trim()
  if (text === "") {
    if (filter !== null) return []
    return [
      ...(addsBlocks
        ? [{ _tag: "Pick", pick: { _tag: "NewBlock", text: "" } } satisfies Option]
        : []),
      { _tag: "Filter", filter: "blocks" },
      { _tag: "Filter", filter: "pages" },
    ]
  }
  const exact = pages.some((page) => page.name === normalizePageName(text))
  const creates: ReadonlyArray<Option> =
    filter === null
      ? [
          ...(addsBlocks
            ? [{ _tag: "Pick", pick: { _tag: "NewBlock", text } } satisfies Option]
            : []),
          ...(exact
            ? []
            : [
                { _tag: "Pick", pick: { _tag: "NewPage", title: text } } satisfies Option,
                { _tag: "Pick", pick: { _tag: "NewWhiteboard", title: text } } satisfies Option,
              ]),
        ]
      : []
  return [
    ...creates,
    ...pages.map((page): Option => ({ _tag: "Pick", pick: { _tag: "Page", page } })),
    ...blocks.map((block): Option => ({ _tag: "Pick", pick: { _tag: "Block", block } })),
  ]
}

const RowIcon = ({ option }: { readonly option: Option }) => {
  if (option._tag === "Filter") {
    return option.filter === "blocks" ? <IconLetterCase size={14} /> : <IconFile size={14} />
  }
  switch (option.pick._tag) {
    case "NewBlock":
      return <IconCirclePlus size={14} />
    case "NewPage":
      return <IconFileText size={14} />
    case "NewWhiteboard":
      return <IconChalkboard size={14} />
    case "Page":
      return isWhiteboard(option.pick.page) ? <IconChalkboard size={14} /> : <IconFile size={14} />
    case "Block":
      return <IconLetterCase size={14} />
  }
}

const RowLabel = ({ option, query }: { readonly option: Option; readonly query: string }) => {
  if (option._tag === "Filter") {
    return option.filter === "blocks" ? "Search only blocks" : "Search only pages"
  }
  const { pick } = option
  switch (pick._tag) {
    case "NewBlock":
      return pick.text === "" ? "New block" : `New block: ${pick.text}`
    case "NewPage":
      return `New page: ${pick.title}`
    case "NewWhiteboard":
      return `New whiteboard: ${pick.title}`
    case "Page":
      return (
        <span>
          <Marked text={pick.page.title} query={query} />
        </span>
      )
    case "Block":
      return (
        <span>
          <Marked text={pick.block.text.split("\n")[0] ?? ""} query={query} />
        </span>
      )
  }
}

const Row = ({ option, query }: { readonly option: Option; readonly query: string }) => (
  <>
    <span className="wb-search-tag" aria-hidden>
      <RowIcon option={option} />
    </span>
    <span className="wb-search-text">
      <RowLabel option={option} query={query} />
    </span>
  </>
)

export const QuickSearch = ({
  place,
  onPick,
  onCancel,
}: {
  readonly place: { readonly left: number; readonly top: number } | null
  readonly onPick: (pick: Pick) => void
  readonly onCancel: () => void
}) => {
  const linking = place === null
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>(null)
  const [focused, setFocused] = useState(0)
  const choose = (option: Option | undefined) => {
    if (option === undefined) return
    if (option._tag === "Filter") {
      setFilter(option.filter)
      setFocused(0)
    } else onPick(option.pick)
  }
  return (
    <Hits query={query.trim()} filter={filter}>
      {({ pages, blocks }) => {
        const options = optionsFor(query, filter, pages, blocks, !linking)
        const at = Math.min(focused, Math.max(0, options.length - 1))
        return (
          <div
            className="wb-search"
            data-mode={linking ? "link" : "portal"}
            style={place ?? undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="wb-search-row">
              <span className="wb-search-icon" aria-hidden>
                {options[at]?._tag === "Pick" && options[at].pick._tag.startsWith("New") ? (
                  <IconCirclePlus size={22} />
                ) : (
                  <IconSearch size={22} />
                )}
              </span>
              {filter === null ? null : (
                <span className="wb-search-chip">
                  {filter === "blocks" ? "Search only blocks" : "Search only pages"}
                </span>
              )}
              <input
                className="wb-search-input"
                aria-label={
                  linking ? "Search for a page or block to link" : "Create or search your graph"
                }
                placeholder={
                  linking ? "Start typing to search..." : "Create or search your graph..."
                }
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="wb-search-results"
                autoFocus={!linking}
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value)
                  setFocused(0)
                }}
                onBlur={linking ? undefined : onCancel}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Escape") onCancel()
                  else if (event.key === "ArrowDown") {
                    event.preventDefault()
                    setFocused(Math.min(options.length - 1, at + 1))
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault()
                    setFocused(Math.max(0, at - 1))
                  } else if (event.key === "Enter") {
                    event.preventDefault()
                    choose(options[at])
                  } else if (event.key === "Backspace" && query === "" && filter !== null) {
                    setFilter(null)
                  }
                }}
              />
            </div>
            {options.length === 0 ? null : (
              <ul className="wb-search-results" id="wb-search-results" role="listbox">
                {options.map((option, index) => (
                  <li
                    key={index}
                    className="wb-search-option"
                    role="option"
                    aria-selected={index === at}
                    onPointerEnter={() => setFocused(index)}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      choose(option)
                    }}
                  >
                    <Row option={option} query={query.trim()} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      }}
    </Hits>
  )
}
