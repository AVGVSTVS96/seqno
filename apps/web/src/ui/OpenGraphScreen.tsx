import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useId } from "react"
import { openGraph, recentGraphs } from "../atoms.ts"
import { graphTitle } from "../graph-locations.ts"

const RecentGraphs = ({ disabled }: { readonly disabled: boolean }) => {
  const names = AsyncResult.getOrElse(useAtomValue(recentGraphs), () => [])
  const open = useAtomSet(openGraph)
  const title = useId()
  return names.length === 0 ? null : (
    <section className="graphs-list" aria-labelledby={title}>
      <h2 id={title} className="graphs-list-title">
        Local graphs:
      </h2>
      <ul className="graphs-list-items">
        {names.map((location) => (
          <li key={location.name} className="graphs-list-item">
            <button
              type="button"
              className="graphs-list-name"
              disabled={disabled}
              onClick={() => open({ _tag: "Recent", name: location.name })}
            >
              {graphTitle(location.name)}
            </button>
            <small className="graphs-list-detail">
              {location._tag === "FolderGraph"
                ? "A folder on this computer"
                : "Stored in this browser"}
            </small>
          </li>
        ))}
      </ul>
    </section>
  )
}

export const OpenGraphScreen = ({ problem }: { readonly problem: string | null }) => {
  const open = useAtomSet(openGraph)
  const opening = AsyncResult.isWaiting(useAtomValue(openGraph))
  return (
    <div className="welcome">
      <div className="welcome-main">
        <h1 className="welcome-title">All graphs</h1>
        <div className="welcome-actions">
          <button
            type="button"
            className="button-primary"
            disabled={opening}
            onClick={() => open({ _tag: "PickFolder" })}
          >
            Open a folder
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={opening}
            onClick={() => open({ _tag: "Demo" })}
          >
            Open the demo graph
          </button>
        </div>
        {problem === null ? null : (
          <p className="welcome-problem" role="alert">
            {problem}
          </p>
        )}
        <RecentGraphs disabled={opening} />
      </div>
    </div>
  )
}
