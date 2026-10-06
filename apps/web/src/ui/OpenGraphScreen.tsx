import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { openGraph, recentGraphs } from "../atoms.ts"

const RecentGraphs = () => {
  const recent = useAtomValue(recentGraphs)
  const open = useAtomSet(openGraph)
  const names = AsyncResult.getOrElse(recent, () => [])
  return names.length === 0 ? null : (
    <section className="open-recent">
      <h2>Recent graphs</h2>
      {names.map((location) => (
        <button
          key={location.name}
          type="button"
          onClick={() => open({ _tag: "Recent", name: location.name })}
        >
          {location.name}
          <span className="hint">
            {location._tag === "FolderGraph" ? "folder" : "on this device"}
          </span>
        </button>
      ))}
    </section>
  )
}

export const OpenGraphScreen = ({ problem }: { readonly problem: string | null }) => {
  const open = useAtomSet(openGraph)
  const opening = AsyncResult.isWaiting(useAtomValue(openGraph))
  return (
    <div className="open-graph">
      <h1>seqno</h1>
      <p className="hint">
        Open a Logseq graph folder, or try the demo graph stored in this browser.
      </p>
      <div className="open-actions">
        <button type="button" disabled={opening} onClick={() => open({ _tag: "PickFolder" })}>
          Open a folder
        </button>
        <button type="button" disabled={opening} onClick={() => open({ _tag: "Demo" })}>
          Open the demo graph
        </button>
      </div>
      {problem === null ? null : <p className="problem">{problem}</p>}
      <RecentGraphs />
    </div>
  )
}
