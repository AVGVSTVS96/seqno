import { Effect, Layer, Schema, Stream } from "effect"
import { Atom } from "effect/reactivity"
import type { WorkerError } from "effect/workers/WorkerError"
import type { PageId } from "@seqno/domain"
import { PageClient } from "@seqno/rpc"
import { appLayer, settingsLayer } from "../../atoms.ts"
import { WorkerPages } from "../../core.ts"
import { dayOf, TableSort } from "./model.ts"

export const pageLayer = Atom.make<Layer.Layer<PageClient, WorkerError>>(WorkerPages).pipe(
  Atom.keepAlive,
)

export const viewRuntime = Atom.runtime((get) => Layer.merge(get(appLayer), get(pageLayer)))

const watch = <A, E>(open: (client: PageClient["Service"]) => Stream.Stream<A, E>) =>
  Stream.unwrap(Effect.map(Effect.service(PageClient), open))

export const linkedReferences = Atom.family((pageId: PageId) =>
  viewRuntime.atom(watch((client) => client.WatchReferences({ pageId }))),
)

export const nameReferences = Atom.family((name: string) =>
  viewRuntime.atom(watch((client) => client.WatchNameReferences({ name }))),
)

export const unlinkedReferences = Atom.family((pageId: PageId) =>
  viewRuntime.atom(watch((client) => client.WatchUnlinkedReferences({ pageId }))),
)

export const pageStats = viewRuntime.atom(watch((client) => client.WatchPageStats()))

export const today = Atom.make(() => dayOf(new Date()))

const settingsRuntime = Atom.runtime((get) => get(settingsLayer))

export const allPagesSort = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.allPages.sort",
  schema: TableSort,
  defaultValue: (): TableSort => ({ column: "updated", descending: true }),
}).pipe(Atom.keepAlive)

export const allPagesJournals = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.allPages.journals",
  schema: Schema.Boolean,
  defaultValue: () => true,
}).pipe(Atom.keepAlive)
