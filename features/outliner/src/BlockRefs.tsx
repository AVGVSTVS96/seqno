import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { blockReferencesAtom } from "./core.ts"
import { BlockGroups } from "./Query.tsx"

const stop = (event: { stopPropagation: () => void }) => {
  event.stopPropagation()
}

export const BlockRefs = ({ uuid }: { readonly uuid: string }) => {
  const blocks = AsyncResult.getOrElse(useAtomValue(blockReferencesAtom(uuid)), () => [])

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the handlers only keep events from reaching the outliner around these references
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
