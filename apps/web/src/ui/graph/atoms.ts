import { Effect, Option, Schema, Stream } from "effect"
import { AsyncResult, Atom } from "effect/reactivity"
import { PageClient } from "@seqno/rpc"
import { openGraph, settingsLayer } from "../../atoms.ts"
import { viewRuntime } from "../pages/atoms.ts"
import { allPagesScene, pageScene, sameScene, type Scene, type Visibility } from "./model.ts"

export const pagesGraph = viewRuntime.atom(
  Stream.unwrap(Effect.map(Effect.service(PageClient), (client) => client.WatchPagesGraph())),
)

const sceneAtom = (build: (graph: Parameters<typeof allPagesScene>[0]) => Scene) =>
  Atom.make((get): Scene | null =>
    Option.getOrNull(Option.map(AsyncResult.value(get(pagesGraph)), build)),
  ).pipe(
    Atom.withEquality(
      (left: Scene | null, right: Scene | null) =>
        left === right || (left !== null && right !== null && sameScene(left, right)),
    ),
  )

export const allPagesGraph = sceneAtom(allPagesScene)

export const pageGraph = Atom.family((name: string) => sceneAtom((graph) => pageScene(graph, name)))

export const GraphSettings = Schema.Struct({
  depth: Schema.Int,
  linkDistance: Schema.Int,
  journals: Schema.Boolean,
  orphans: Schema.Boolean,
})
export type GraphSettings = typeof GraphSettings.Type

export const defaultGraphSettings: GraphSettings = {
  depth: 1,
  linkDistance: 72,
  journals: false,
  orphans: true,
}

const settingsRuntime = Atom.runtime((get) => get(settingsLayer))

const savedSettings = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.graphView",
  schema: Schema.Record(Schema.String, GraphSettings),
  defaultValue: (): Readonly<Record<string, GraphSettings>> => ({}),
}).pipe(Atom.keepAlive)

const openedName = (read: <A>(atom: Atom.Atom<A>) => A) =>
  Option.getOrElse(
    Option.map(AsyncResult.value(read(openGraph)), (opened) => opened.graph),
    () => "",
  )

export const graphSettings = Atom.writable(
  (get): GraphSettings => get(savedSettings)[openedName(get)] ?? defaultGraphSettings,
  (ctx, next: GraphSettings) =>
    ctx.set(savedSettings, {
      ...ctx.get(savedSettings),
      [openedName((atom) => ctx.get(atom))]: next,
    }),
)

export const timeTravel = Atom.make<number | null>(null)

export const graphVisibility = Atom.make((get): Visibility => ({
  journals: get(graphSettings).journals,
  orphans: get(graphSettings).orphans,
  until: get(timeTravel),
}))
