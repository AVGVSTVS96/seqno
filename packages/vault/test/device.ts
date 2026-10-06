import { Effect, Layer, Schema } from "effect"
import { LoroDoc, VersionVector } from "loro-crdt"
import { DeviceId } from "@seqno/domain"
import { Vault, layer, loroReplica, type Storage } from "@seqno/vault"

export const deviceId = Schema.decodeUnknownSync(DeviceId)

export interface DeviceOptions {
  readonly id: string
  readonly peer: `${number}`
  readonly members: ReadonlyArray<string>
  readonly storage: Layer.Layer<Storage>
  readonly compactAfterFiles?: number
}

export const makeDevice = (options: DeviceOptions) =>
  Effect.gen(function* () {
    const doc = new LoroDoc()
    doc.setPeerId(options.peer)
    const vault = yield* Effect.provide(
      Vault,
      layer({
        device: deviceId(options.id),
        peer: options.peer,
        members: options.members.map((member) => deviceId(member)),
        compactAfterFiles: options.compactAfterFiles ?? 1_000_000,
        compactEvery: 0,
      }).pipe(Layer.provide(options.storage)),
    )
    const flushed = { counter: 0 }
    const pendingUpdate = () => {
      const from = doc.oplogVersion().toJSON()
      from.set(options.peer, flushed.counter)
      flushed.counter = doc.oplogVersion().get(options.peer) ?? 0
      return doc.export({ mode: "update", from: VersionVector.parseJSON(from) })
    }
    const type = (text: string) => {
      const body = doc.getText("body")
      body.insert(body.length, text)
      doc.commit()
      return vault.writeUpdate(pendingUpdate())
    }
    return {
      doc,
      vault,
      type,
      sync: vault.sync(loroReplica(doc)),
      text: () => doc.getText("body").toString(),
    }
  })
