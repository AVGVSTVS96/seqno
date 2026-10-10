import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconDots } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { useId } from "react"
import { attemptedGraph, forgetGraph, graphsOpenedAt, openGraph, recentGraphs } from "../atoms.ts"
import { demoGraph, demoGraphs, graphTitle, type GraphLocation } from "../graph-locations.ts"
import { useSwitchGraph } from "./shell/GraphSwitcher.tsx"
import { Menu, MenuItem, usePopover } from "./shell/popover.tsx"

const openedOn = (at: number) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

const GraphRow = ({
  location,
  openedAt,
  disabled,
}: {
  readonly location: GraphLocation
  readonly openedAt: number | undefined
  readonly disabled: boolean
}) => {
  const open = useSwitchGraph()
  const forget = useAtomSet(forgetGraph)
  const menu = usePopover({ placement: { align: "end", gap: 4, inset: 8 }, kind: "menu" })
  const title = graphTitle(location.name)
  return (
    <li className="graphs-list-item">
      <div className="graphs-list-main">
        <button
          type="button"
          className="graphs-list-name"
          disabled={disabled}
          onClick={() => open({ _tag: "Recent", name: location.name })}
        >
          {title}
        </button>
        <small className="graphs-list-detail">
          {openedAt === undefined
            ? location._tag === "FolderGraph"
              ? "A folder on this computer"
              : "Stored in this browser"
            : `Last opened at: ${openedOn(openedAt)}`}
        </small>
      </div>
      <button
        type="button"
        className="graphs-list-actions"
        aria-label={`Actions for ${title}`}
        {...menu.trigger}
      >
        <IconDots size={15} aria-hidden />
      </button>
      <Menu handle={menu} label={title} className="graphs-list-menu">
        <MenuItem onSelect={() => forget(location.name)}>Remove from the list</MenuItem>
      </Menu>
    </li>
  )
}

const RecentGraphs = ({ disabled }: { readonly disabled: boolean }) => {
  const locations = AsyncResult.getOrElse(useAtomValue(recentGraphs), () => [])
  const openedAt = useAtomValue(graphsOpenedAt)
  const title = useId()
  const listed = locations.toSorted(
    (left, right) => (openedAt[right.name] ?? 0) - (openedAt[left.name] ?? 0),
  )
  return listed.length === 0 ? null : (
    <section className="graphs-list" aria-labelledby={title}>
      <h2 id={title} className="graphs-list-title">
        Local graphs:
      </h2>
      <ul className="graphs-list-items">
        {listed.map((location) => (
          <GraphRow
            key={location.name}
            location={location}
            openedAt={openedAt[location.name]}
            disabled={disabled}
          />
        ))}
      </ul>
    </section>
  )
}

export const AllGraphs = ({ problem }: { readonly problem: string | null }) => {
  const open = useSwitchGraph()
  const opening = AsyncResult.isWaiting(useAtomValue(openGraph))
  return (
    <div className="welcome-main">
      <title>Graphs</title>
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
        {demoGraphs.map((name) => (
          <button
            key={name}
            type="button"
            className="button-secondary"
            disabled={opening}
            onClick={() => open({ _tag: "Demo", name })}
          >
            Open {graphTitle(name)}
          </button>
        ))}
      </div>
      {problem === null ? null : (
        <p className="welcome-problem" role="alert">
          {problem}
        </p>
      )}
      <RecentGraphs disabled={opening} />
    </div>
  )
}

export const OpenFailed = ({ problem }: { readonly problem: string }) => {
  const attempted = useAtomValue(attemptedGraph)
  const open = useSwitchGraph()
  const opening = AsyncResult.isWaiting(useAtomValue(openGraph))
  return (
    <div className="seqno-all-graphs">
      <div className="welcome-main">
        <title>Graphs</title>
        <h1 className="welcome-title">
          {attempted === null ? "The graph" : graphTitle(attempted)} could not be opened
        </h1>
        <p className="welcome-problem" role="alert">
          {problem}
        </p>
        <div className="welcome-actions">
          {attempted === null ? null : (
            <button
              type="button"
              className="button-primary"
              disabled={opening}
              onClick={() => open({ _tag: "Recent", name: attempted })}
            >
              Retry
            </button>
          )}
          {attempted === demoGraph ? null : (
            <button
              type="button"
              className="button-secondary"
              disabled={opening}
              onClick={() => open({ _tag: "Demo", name: demoGraph })}
            >
              Open {graphTitle(demoGraph)}
            </button>
          )}
        </div>
        <RecentGraphs disabled={opening} />
      </div>
    </div>
  )
}

export const OpenGraphScreen = ({ problem }: { readonly problem: string | null }) => (
  <div className="welcome">
    <AllGraphs problem={problem} />
  </div>
)
