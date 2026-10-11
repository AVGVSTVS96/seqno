import { Context, Effect, Layer, Option } from "effect"
import { decodeImportBlobMeta } from "loro-crdt"
import type { PageId } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { Graphs, type Replica, type ReplicaSpec } from "./ports.ts"
import type { Span, VV } from "./vv.ts"

const vvOf = (version: ReadonlyMap<string, number>): VV => Object.fromEntries(version)

const blobSpan = (bytes: Uint8Array, checksum: boolean): Option.Option<Span> => {
  try {
    const meta = decodeImportBlobMeta(bytes, checksum)
    return Option.some({
      start:
        meta.mode === "snapshot" ? {} : Object.fromEntries(meta.partialStartVersionVector.toJSON()),
      end: Object.fromEntries(meta.partialEndVersionVector.toJSON()),
    })
  } catch {
    return Option.none()
  }
}

const open = (spec: ReplicaSpec) =>
  Effect.gen(function* () {
    const graph = Context.get(
      yield* Effect.orDie(
        Layer.build(
          Graph.layer({
            peer: PeerId.make(String(spec.peer)),
            snapshot: Option.none(),
            updates: [],
          }),
        ),
      ),
      Graph,
    )
    const synced = vaultReplica({
      ...graph,
      merge: (blobs) =>
        Effect.flatMap(graph.version, (version) =>
          version.size === 0 ? Effect.as(graph.restore(blobs), []) : graph.merge(blobs),
        ),
    })
    const pages = Effect.map(graph.pages, (all) => all.toSorted((a, b) => (a.id < b.id ? -1 : 1)))
    const trees = Effect.flatMap(pages, (all) =>
      Effect.forEach(all, (page) => Effect.orDie(graph.page(page.id))),
    )
    const replica: Replica = {
      peer: String(spec.peer),
      dispatch: graph.dispatch,
      block: (id) => Effect.option(graph.block(id)),
      pageAlive: (id) => Effect.map(graph.pages, (all) => all.some((page) => page.id === id)),
      children: (pageId: PageId, parentId) =>
        Effect.map(Effect.option(graph.page(pageId)), (tree) =>
          Option.match(tree, {
            onNone: () => [],
            onSome: ({ blocks }) =>
              blocks.filter((block) => block.parentId === parentId).map((block) => block.id),
          }),
        ),
      fate: () =>
        Effect.die(new Error("the real graph is checked by its final state, not by fate")),
      version: Effect.map(graph.version, vvOf),
      exportUpdates: () => Effect.die(new Error("the real graph saves through flushTo")),
      flushTo: (write) => Effect.asVoid(graph.flush((update) => write(update.bytes))),
      exportSnapshot: graph.snapshot,
      importBlobs: synced.merge,
      canonical: Effect.map(trees, (all) => JSON.stringify(all)),
      liveNodes: Effect.map(trees, (all) =>
        all.reduce((sum, tree) => sum + 1 + tree.blocks.length, 0),
      ),
      shape: Effect.map(trees, (all) => ({
        names: all.map((tree) => tree.page.name),
        blocks: all.flatMap((tree) => tree.blocks.map((block) => block.id)),
      })),
    }
    return replica
  })

export const RealGraphs = Layer.succeed(Graphs, Graphs.of({ open, blobSpan, full: true }))
