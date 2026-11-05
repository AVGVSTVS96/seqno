import { Context, Effect, Layer, Option } from "effect"
import { SecureRandom } from "effect/crypto"
import { Graph, PeerId, graphV2Layer } from "@seqno/graph"

const WebCrypto = Layer.succeed(
  SecureRandom.SecureRandom,
  SecureRandom.make((size) => globalThis.crypto.getRandomValues(new Uint8Array(size))),
)

export const serviceOf = <I, S, E>(tag: Context.Key<I, S>, layer: Layer.Layer<I, E>) =>
  Effect.map(Layer.build(layer), (context) => Context.get(context, tag))

export const emptyGraph = (peer: string) =>
  serviceOf(
    Graph,
    Graph.layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }).pipe(
      Layer.provide(WebCrypto),
    ),
  )

export const emptyPagesGraph = (peer: string) =>
  serviceOf(
    Graph,
    graphV2Layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }).pipe(
      Layer.provide(WebCrypto),
    ),
  )
