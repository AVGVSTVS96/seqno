import graphCss from "./graph.css?inline"
import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconChevronDown,
  IconHistory,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconX,
} from "@tabler/icons-react"
import { useNavigate } from "@tanstack/react-router"
import { Atom } from "effect/reactivity"
import { useContext, useId, useRef, useState, type ReactNode } from "react"
import { resolvedTheme, rightSidebar } from "../../atoms.ts"
import {
  allPagesGraph,
  graphSettings,
  graphVisibility,
  pageGraph,
  timeTravel,
  type GraphSettings,
} from "./atoms.ts"
import { countVisible, createdRange, visibleOf, type Scene, type Visibility } from "./model.ts"
import { createGraphView, type GraphView as View } from "./view.ts"

interface Picked {
  readonly name: string
  readonly title: string
}

export const GraphStyle = () => (
  <style href="seqno/graph" precedence="app">
    {graphCss}
  </style>
)

const everything = Atom.make<Visibility>({ journals: true, orphans: true, until: null })

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`

const SelectionStatus = ({
  picked,
  onOpen,
}: {
  readonly picked: ReadonlyArray<Picked>
  readonly onOpen: (name: string) => void
}) => (
  <div className="graph-status" role="region" aria-label="Selected nodes">
    <p aria-live="polite">
      {picked.length === 0
        ? "No graph node selected."
        : `${plural(picked.length, "node", "nodes")} selected: ${picked
            .slice(0, 5)
            .map((node) => node.title)
            .join(", ")}`}
    </p>
    {picked.length === 0 ? null : (
      <ul>
        {picked.map((node) => (
          <li key={node.name}>
            <button type="button" onClick={() => onOpen(node.name)}>
              Open {node.title}
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
)

const Surface = ({
  scene,
  visibility,
  label,
  children,
}: {
  readonly scene: Atom.Atom<Scene | null>
  readonly visibility: Atom.Atom<Visibility>
  readonly label: string
  readonly children?: (view: View, picked: ReadonlyArray<Picked>) => ReactNode
}) => {
  const registry = useContext(RegistryContext)
  const navigate = useNavigate()
  const updateSidebar = useAtomSet(rightSidebar)
  const [picked, setPicked] = useState<ReadonlyArray<Picked>>([])
  const [ready, setReady] = useState(false)
  const open = (name: string) => void navigate({ to: "/page/$name", params: { name } })
  const [view] = useState(() =>
    createGraphView({
      open,
      sidebar: (name) => updateSidebar({ _tag: "Open", item: { _tag: "Page", name } }),
      select: setPicked,
      ready: setReady,
    }),
  )
  const [attach] = useState(() => (canvas: HTMLCanvasElement | null) => {
    if (canvas === null) return
    const detach = view.attach(canvas)
    const stops = [
      registry.subscribe(resolvedTheme, view.setTheme, { immediate: true }),
      registry.subscribe(
        graphSettings,
        (settings) => {
          view.setDepth(settings.depth)
          view.setLinkDistance(settings.linkDistance)
        },
        { immediate: true },
      ),
      registry.subscribe(visibility, view.setVisibility, { immediate: true }),
      registry.subscribe(
        scene,
        (current) => {
          if (current !== null) view.setScene(current)
        },
        { immediate: true },
      ),
    ]
    return () => {
      for (const stop of stops) stop()
      detach()
    }
  })
  return (
    <div className="graph-root">
      <canvas ref={attach} className="graph-canvas" role="application" aria-label={label} />
      {ready ? null : <div className="graph-loading">Preparing graph…</div>}
      <SelectionStatus picked={picked} onOpen={open} />
      {children?.(view, picked)}
    </div>
  )
}

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly disabled?: boolean
  readonly onChange: (value: number) => void
}) => (
  <label className="graph-control" data-disabled={disabled}>
    <span className="graph-control-head">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
    <input
      type="range"
      className="graph-range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    />
  </label>
)

const SettingsPanel = ({
  scene,
  picked,
  onClose,
}: {
  readonly scene: Scene | null
  readonly picked: ReadonlyArray<Picked>
  readonly onClose: () => void
}) => {
  const [settings, setSettings] = useAtom(graphSettings)
  const visibility = useAtomValue(graphVisibility)
  const journalsLabel = useId()
  const orphansLabel = useId()
  const counts =
    scene === null ? { nodes: 0, links: 0 } : countVisible(scene, visibleOf(scene, visibility))
  const change = (next: Partial<GraphSettings>) => setSettings({ ...settings, ...next })
  return (
    <section className="graph-settings-panel" aria-label="Graph settings">
      <div className="graph-settings-head">
        <div>
          <h2 className="graph-settings-title">Graph settings</h2>
          <p className="graph-settings-subtitle">Saved per graph</p>
        </div>
        <button type="button" className="graph-settings-close" aria-label="Close" onClick={onClose}>
          <IconX size={18} aria-hidden />
        </button>
      </div>
      <section className="graph-settings-group" aria-label="Layout">
        <h3 className="graph-settings-group-head">
          <span className="graph-settings-group-title">Layout</span>
          <span className="graph-settings-group-meta">Force graph</span>
        </h3>
        <div className="graph-settings-group-body">
          <div className="graph-stats">
            <span>{plural(counts.nodes, "node", "nodes")}</span>
            <span>{plural(counts.links, "link", "links")}</span>
          </div>
          <Slider
            label="Depth"
            value={settings.depth}
            min={1}
            max={5}
            step={1}
            disabled={picked.length === 0}
            onChange={(depth) => change({ depth })}
          />
          <Slider
            label="Link distance"
            value={settings.linkDistance}
            min={36}
            max={180}
            step={6}
            onChange={(linkDistance) => change({ linkDistance })}
          />
          <div className="graph-toggle">
            <span id={journalsLabel}>Show journals</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.journals}
              aria-labelledby={journalsLabel}
              className="switch"
              onClick={() => change({ journals: !settings.journals })}
            >
              <span className="switch-thumb" />
            </button>
          </div>
          <div className="graph-toggle">
            <span id={orphansLabel}>Orphan pages</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.orphans}
              aria-labelledby={orphansLabel}
              className="switch"
              onClick={() => change({ orphans: !settings.orphans })}
            >
              <span className="switch-thumb" />
            </button>
          </div>
        </div>
      </section>
    </section>
  )
}

const dateOf = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })

const travelMs = 4500

const TimeTravel = ({ scene }: { readonly scene: Scene | null }) => {
  const [open, setOpen] = useState(false)
  const [until, setUntil] = useAtom(timeTravel)
  const playing = useRef<number | null>(null)
  const [settle] = useState(() => (element: HTMLDivElement | null) => {
    if (element === null) return
    return () => {
      if (playing.current !== null) cancelAnimationFrame(playing.current)
    }
  })
  const range = scene === null ? null : createdRange(scene)
  if (range === null) return null
  const span = range.last - range.first
  const value = until === null ? span : Math.min(span, Math.max(0, until - range.first))
  const travel = (offset: number) => setUntil(offset >= span ? null : range.first + offset)
  const stop = () => {
    if (playing.current !== null) cancelAnimationFrame(playing.current)
    playing.current = null
  }
  const play = () => {
    stop()
    const from = value >= span ? 0 : value
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / travelMs)
      travel(from + (span - from) * progress)
      playing.current = progress < 1 ? requestAnimationFrame(step) : null
    }
    playing.current = requestAnimationFrame(step)
  }
  return (
    <div className="graph-time-travel" data-open={open} ref={settle}>
      <button
        type="button"
        className="graph-tool"
        aria-label="Time travel"
        aria-expanded={open}
        title="Time travel"
        onClick={() => setOpen(!open)}
      >
        {open ? <IconChevronDown size={18} aria-hidden /> : <IconHistory size={18} aria-hidden />}
      </button>
      <div className="graph-time-travel-panel" inert={!open}>
        <button
          type="button"
          className="graph-tool graph-time-travel-play"
          aria-label="Play to now"
          title="Play to now"
          onClick={play}
        >
          <IconPlayerPlay size={18} aria-hidden />
        </button>
        <div className="graph-time-travel-body">
          <div className="graph-time-travel-label">
            <span>Time travel</span>
            <strong>{until === null ? "Now" : dateOf(range.first + value)}</strong>
          </div>
          <input
            type="range"
            className="graph-range"
            aria-label="Time travel"
            min={0}
            max={span}
            step={Math.max(1, Math.floor(span / 240))}
            value={value}
            onChange={(event) => {
              stop()
              travel(Number(event.currentTarget.value))
            }}
          />
          <div className="graph-time-travel-ticks">
            <span>{dateOf(range.first)}</span>
            <span>{dateOf(range.last)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const Toolbar = ({
  view,
  picked,
}: {
  readonly view: View
  readonly picked: ReadonlyArray<Picked>
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const scene = useAtomValue(allPagesGraph)
  return (
    <div className="graph-toolbar">
      <div className="graph-settings">
        {settingsOpen ? (
          <SettingsPanel scene={scene} picked={picked} onClose={() => setSettingsOpen(false)} />
        ) : null}
        <button
          type="button"
          className="graph-tool"
          aria-label="Graph settings"
          aria-expanded={settingsOpen}
          title="Graph settings"
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          {settingsOpen ? (
            <IconChevronDown size={18} aria-hidden />
          ) : (
            <IconSettings size={18} aria-hidden />
          )}
        </button>
      </div>
      <TimeTravel scene={scene} />
      {picked.length === 0 ? null : (
        <button
          type="button"
          className="graph-tool"
          aria-label="Reset view"
          title="Reset view"
          onClick={view.reset}
        >
          <IconRefresh size={18} aria-hidden />
        </button>
      )}
    </div>
  )
}

export const GraphView = () => (
  <div className="seqno-graph-view">
    <GraphStyle />
    <Surface scene={allPagesGraph} visibility={graphVisibility} label="Graph canvas">
      {(view, picked) => <Toolbar view={view} picked={picked} />}
    </Surface>
  </div>
)

export const PageGraph = ({ name }: { readonly name: string }) => (
  <div className="seqno-page-graph">
    <GraphStyle />
    <Surface key={name} scene={pageGraph(name)} visibility={everything} label="Page graph" />
  </div>
)
