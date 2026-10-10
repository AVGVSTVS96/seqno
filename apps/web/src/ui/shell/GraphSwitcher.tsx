import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconApps,
  IconDatabase,
  IconFolderOpen,
  IconSelector,
  IconTopologyStar,
} from "@tabler/icons-react"
import { useNavigate } from "@tanstack/react-router"
import { Exit } from "effect"
import { AsyncResult } from "effect/reactivity"
import { openGraph, recentGraphs, rightSidebar, type GraphSource } from "../../atoms.ts"
import { demoGraphs, graphTitle } from "../../graph-locations.ts"
import { Menu, MenuItem, usePopover } from "./popover.tsx"

export const useSwitchGraph = () => {
  const open = useAtomSet(openGraph, { mode: "promiseExit" })
  const updateSidebar = useAtomSet(rightSidebar)
  const navigate = useNavigate()
  return (source: GraphSource) =>
    void open(source).then((exit) => {
      if (!Exit.isSuccess(exit)) return
      updateSidebar({ _tag: "Clear" })
      void navigate({ to: "/" })
    })
}

export const GraphSwitcher = ({ graph }: { readonly graph: string }) => {
  const refreshRecent = useAtomRefresh(recentGraphs)
  const others = AsyncResult.getOrElse(useAtomValue(recentGraphs), () => []).filter(
    (location) => location.name !== graph,
  )
  const switchTo = useSwitchGraph()
  const navigate = useNavigate()
  const menu = usePopover({
    placement: { align: "start", gap: 4, inset: 8 },
    kind: "menu",
    onOpen: refreshRecent,
  })
  return (
    <div className="graph-switcher">
      <button type="button" className="graph-switcher-trigger" {...menu.trigger}>
        <span className="graph-thumb" aria-hidden>
          <IconTopologyStar size={16} />
        </span>
        <strong className="graph-name">{graphTitle(graph)}</strong>
        <IconSelector className="graph-selector" size={16} aria-hidden />
      </button>
      <Menu handle={menu} label="Graphs" className="graphs-menu">
        {others.length === 0 ? null : (
          <>
            <div className="graphs-menu-heading">Switch to:</div>
            {others.map((location) => (
              <MenuItem
                key={location.name}
                onSelect={() => switchTo({ _tag: "Recent", name: location.name })}
              >
                {graphTitle(location.name)}
              </MenuItem>
            ))}
          </>
        )}
        <div className="graphs-menu-actions">
          <MenuItem
            icon={<IconFolderOpen size={18} aria-hidden />}
            onSelect={() => switchTo({ _tag: "PickFolder" })}
          >
            Open a folder
          </MenuItem>
          {demoGraphs
            .filter((name) => name !== graph && !others.some((location) => location.name === name))
            .map((name) => (
              <MenuItem
                key={name}
                icon={<IconDatabase size={18} aria-hidden />}
                onSelect={() => switchTo({ _tag: "Demo", name })}
              >
                {graphTitle(name)}
              </MenuItem>
            ))}
          <MenuItem
            icon={<IconApps size={18} aria-hidden />}
            onSelect={() => void navigate({ to: "/graphs" })}
          >
            All graphs
          </MenuItem>
        </div>
      </Menu>
    </div>
  )
}
