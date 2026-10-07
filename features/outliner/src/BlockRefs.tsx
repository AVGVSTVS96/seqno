import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { blockReferencesAtom } from "./core.ts"
import { BlockGroups } from "./Query.tsx"

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export const BlockRefs = ({ uuid }: { readonly uuid: string }) => {
  const blocks = AsyncResult.getOrElse(useAtomValue(blockReferencesAtom(uuid)), () => [])
  return (
    <section
      className="seqno-block-refs"
      aria-label="Block references"
      onClick={stop}
      onPointerDown={stop}
      onDragOver={stop}
      onDrop={stop}
      onKeyDown={stop}
    >
      <BlockGroups blocks={blocks} />
    </section>
  )
}
