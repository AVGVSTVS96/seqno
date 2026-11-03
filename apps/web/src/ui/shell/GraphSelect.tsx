import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { AsyncResult, Atom } from "effect/reactivity"
import { useState } from "react"
import { logseq } from "@seqno/dom"
import { forgetGraph, openGraph, recentGraphs } from "../../atoms.ts"
import { canPickFolders } from "../../embed.ts"
import { graphTitle, isDemoGraph } from "../../graph-locations.ts"
import { useSwitchGraph } from "./GraphSwitcher.tsx"
import { Dialog } from "./popover.tsx"

export type GraphSelectKind = "open" | "remove"

export const graphSelect = Atom.make<GraphSelectKind | null>(null).pipe(Atom.keepAlive)

const prompts: Record<GraphSelectKind, string> = { open: "Select a graph", remove: "Select one" }

const Select = ({
  kind,
  onClose,
}: {
  readonly kind: GraphSelectKind
  readonly onClose: () => void
}) => {
  const refresh = useAtomRefresh(recentGraphs)
  const current = AsyncResult.getOrElse(useAtomValue(openGraph), () => null)?.graph
  const switchTo = useSwitchGraph()
  const forget = useAtomSet(forgetGraph)
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const graphs = AsyncResult.getOrElse(useAtomValue(recentGraphs), () => [])
    .map((location) => location.name)
    .filter((name) => !isDemoGraph(name) && name !== current)
  const wanted = query.trim().toLowerCase()
  const shown = graphs.filter((name) => graphTitle(name).toLowerCase().includes(wanted))
  const chosen = Math.min(index, shown.length - 1)
  const choose = (name: string) => {
    onClose()
    if (kind === "open") switchTo({ _tag: "Recent", name })
    else forget(name)
  }
  const addGraph = () => {
    onClose()
    if (canPickFolders) switchTo({ _tag: "PickFolder" })
    else void navigate({ to: "/graphs" })
  }
  return (
    <Dialog
      id="seqno-graph-select"
      label={prompts[kind]}
      className="seqno-graph-select"
      onClose={onClose}
      ref={(dialog) => {
        if (dialog === null || dialog.open) return
        refresh()
        dialog.showModal()
      }}
    >
      <div {...logseq("seqno-select")}>
        <input
          {...logseq("seqno-select-input")}
          type="text"
          aria-label={prompts[kind]}
          placeholder={prompts[kind]}
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              const step = event.key === "ArrowDown" ? 1 : -1
              setIndex((chosen + step + shown.length) % Math.max(shown.length, 1))
            } else if (event.key === "Enter") {
              event.preventDefault()
              const name = shown[chosen]
              if (name !== undefined) choose(name)
            }
          }}
        />
        {shown.length === 0 ? (
          kind === "open" ? (
            <div className="seqno-select-empty">
              <p>No matched graphs. Do you want to add another one?</p>
              <button type="button" onClick={addGraph}>
                Yes, add another graph
              </button>
            </div>
          ) : null
        ) : (
          <ul {...logseq("seqno-select-results")} role="listbox" aria-label="Graphs">
            {shown.map((name, at) => (
              <li
                key={name}
                role="option"
                aria-selected={at === chosen}
                className="seqno-select-item"
                onMouseMove={() => setIndex(at)}
                onClick={() => choose(name)}
              >
                {graphTitle(name)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

export const GraphSelect = () => {
  const [kind, setKind] = useAtom(graphSelect)
  return kind === null ? null : <Select key={kind} kind={kind} onClose={() => setKind(null)} />
}
