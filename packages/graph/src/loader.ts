import type { CounterSpan, LoroDoc, PeerID, VersionVector } from "loro-crdt"

interface Held {
  readonly bytes: Uint8Array
  readonly missing: ReadonlyMap<PeerID, CounterSpan>
}

const reaches = (version: VersionVector, held: Held, edge: (span: CounterSpan) => number) =>
  [...held.missing].every(([peer, span]) => (version.get(peer) ?? 0) >= edge(span))

export const loader = (doc: LoroDoc) => {
  let held: Array<Held> = []
  const hold = (bytes: Uint8Array) => {
    const { pending } = doc.import(bytes)
    if (pending !== null) held.push({ bytes, missing: pending })
  }
  const settle = () => {
    for (let version = doc.oplogVersion(); held.length > 0;) {
      const waiting = held.filter((entry) => !reaches(version, entry, (span) => span.end))
      const stuck = waiting.filter((entry) => reaches(version, entry, (span) => span.start))
      held = waiting.filter((entry) => !stuck.includes(entry))
      stuck.forEach((entry) => hold(entry.bytes))
      const before = version
      version = doc.oplogVersion()
      if (version.compare(before) !== 1) return
    }
  }
  return (files: ReadonlyArray<Uint8Array>) => {
    for (const bytes of files) {
      hold(bytes)
      settle()
    }
  }
}
