import { assert, describe, it } from "@effect/vitest"
import { LoroDoc } from "loro-crdt"
import { loader } from "../src/loader.ts"

const history = () => {
  const source = new LoroDoc()
  source.setPeerId(1n)
  const tree = source.getTree("tree")
  const garden = tree.createNode()
  garden.data.set("text", "garden")
  source.commit()
  const snapshot = source.export({ mode: "snapshot" })
  const before = source.oplogVersion()
  garden.createNode().data.set("text", "beds")
  source.commit()
  const beds = source.export({ mode: "update", from: before })
  const after = source.oplogVersion()
  garden.createNode().data.set("text", "paths")
  source.commit()
  const paths = source.export({ mode: "update", from: after })
  return { source, snapshot, beds, paths }
}

describe("loading update files in any order", () => {
  it("applies an update that came before the snapshot it builds on", () => {
    const { source, snapshot, beds, paths } = history()
    const doc = new LoroDoc()
    doc.subscribe(() => {})
    loader(doc)([beds, snapshot, paths])
    assert.deepStrictEqual(doc.toJSON(), source.toJSON())
  })

  it("applies it when the snapshot arrives in a later load", () => {
    const { source, snapshot, beds, paths } = history()
    const doc = new LoroDoc()
    const load = loader(doc)
    load([beds])
    load([snapshot])
    load([paths])
    assert.deepStrictEqual(doc.toJSON(), source.toJSON())
  })
})
