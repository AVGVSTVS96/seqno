import { Effect } from "effect"
import { Atom } from "effect/reactivity"
import { CoreClient, PageClient } from "@seqno/rpc"
import { searchOpen } from "../../atoms.ts"
import { viewRuntime } from "../pages/atoms.ts"
import { noHits, type Hits } from "./model.ts"

export const paletteQuery = Atom.make("").pipe(Atom.keepAlive)

export const paletteHits = viewRuntime.atom((get) => {
  const text = get(paletteQuery).trim()
  return text === ""
    ? Effect.succeed(noHits)
    : Effect.gen(function* () {
        const hits = yield* (yield* CoreClient).Search({ text })
        const ancestors = yield* (yield* PageClient).Ancestors({
          blockIds: hits.blocks.map((block) => block.id),
        })
        return { pages: hits.pages, blocks: hits.blocks, ancestors } satisfies Hits
      })
})

interface KeyPress {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

export const isSearchKey = (event: KeyPress) =>
  event.key.toLowerCase() === "k" &&
  (event.metaKey || event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey

export const searchShortcut = Atom.make((get) => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isSearchKey(event) || get.registry.get(searchOpen)) return
    event.preventDefault()
    get.registry.set(searchOpen, true)
  }
  window.addEventListener("keydown", onKeyDown, { capture: true })
  get.addFinalizer(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
})
