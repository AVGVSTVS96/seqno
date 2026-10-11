import type { LoroDoc } from "loro-crdt"

export const loader = (doc: LoroDoc) => {
  const held: Array<Uint8Array> = []
  const reimportHeld = () => {
    for (let progressed = true; progressed && held.length > 0;) {
      const ready = held.filter((bytes) => doc.import(bytes).pending === null)
      progressed = ready.length > 0
      for (const bytes of ready) held.splice(held.indexOf(bytes), 1)
    }
  }
  return (files: ReadonlyArray<Uint8Array>) => {
    for (const bytes of files) {
      if (doc.import(bytes).pending !== null) held.push(bytes)
      reimportHeld()
    }
  }
}
