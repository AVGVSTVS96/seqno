import { Effect } from "effect"
import { Atom } from "effect/reactivity"
import { CoreClient, PageClient } from "@seqno/rpc"
import { searchOpen } from "../../atoms.ts"
import { viewRuntime } from "../pages/atoms.ts"
import { noHits, type Hits } from "./model.ts"

export const paletteQuery = Atom.make("").pipe(Atom.keepAlive)

const hitsOf = (text: string) =>
  Effect.gen(function* () {
    const hits = yield* (yield* CoreClient).Search({ text })
    const ancestors = yield* (yield* PageClient).Ancestors({
      blockIds: hits.blocks.map((block) => block.id),
    })
    return { pages: hits.pages, blocks: hits.blocks, ancestors } satisfies Hits
  })

export const paletteHits = viewRuntime.atom((get) => {
  const text = get(paletteQuery).trim()
  return text === "" ? Effect.succeed(noHits) : hitsOf(text)
})

export const searchHits = Atom.family((text: string) => viewRuntime.atom(hitsOf(text)))

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
