import { useAtomSet } from "@effect/atom-react"
import { Option } from "effect"
import { Atom } from "effect/reactivity"
import { useId } from "react"
import { graphLocked, openGraph } from "../../atoms.ts"
import { PagesStyle } from "../PageView.tsx"

export const GraphInUse = ({ graph }: { readonly graph: string }) => {
  const open = useAtomSet(openGraph)
  const setLocked = useAtomSet(graphLocked)
  const title = useId()
  return (
    <main className="seqno-graph-in-use" aria-labelledby={title}>
      <PagesStyle />
      <div className="seqno-graph-in-use-card" role="status">
        <h1 id={title}>This graph is open in another tab</h1>
        <p>
          <strong>{graph}</strong> can be open in one tab at a time, so no edit gets lost. Close it
          in the other tab and it opens here.
        </p>
        <button
          type="button"
          onClick={() => {
            open(Atom.Reset)
            setLocked(Option.none())
          }}
        >
          Open another graph
        </button>
      </div>
    </main>
  )
}
