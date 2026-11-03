import { Effect } from "effect"
import { Atom, type AtomRegistry } from "effect/reactivity"
import type { PageId } from "@seqno/domain"
import { CoreClient, PageClient } from "@seqno/rpc"
import { searchOpen } from "../../atoms.ts"
import { viewRuntime } from "../pages/atoms.ts"
import { noHits, type Filter, type Hits } from "./model.ts"

export const paletteQuery = Atom.make("").pipe(Atom.keepAlive)

export const paletteFilter = Atom.make<Filter | null>(null).pipe(Atom.keepAlive)

export const openPalette = (registry: AtomRegistry.AtomRegistry, filter: Filter | null) => {
  registry.set(paletteFilter, filter)
  if (filter !== null) registry.set(paletteQuery, "")
  registry.set(searchOpen, true)
}

const hitsOf = (text: string, pageId?: PageId) =>
  Effect.gen(function* () {
    const hits = yield* (yield* CoreClient).Search(
      pageId === undefined ? { text } : { text, pageId },
    )
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

export const pageHits = Atom.family((pageId: PageId | null) =>
  viewRuntime.atom((get) => {
    const text = get(paletteQuery).trim()
    return text === "" || pageId === null ? Effect.succeed(noHits) : hitsOf(text, pageId)
  }),
)

interface KeyPress {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

const modKey = (event: KeyPress, key: string, shift: boolean) =>
  event.key.toLowerCase() === key &&
  (event.metaKey || event.ctrlKey) &&
  event.shiftKey === shift &&
  !event.altKey

export const isSearchKey = (event: KeyPress) => modKey(event, "k", false)

export const paletteKey = (event: KeyPress): Filter | null | undefined =>
  modKey(event, "p", true)
    ? "commands"
    : modKey(event, "k", true)
      ? "current-page"
      : isSearchKey(event)
        ? null
        : undefined

export const searchShortcut = Atom.make((get) => {
  const onKeyDown = (event: KeyboardEvent) => {
    const filter = paletteKey(event)
    if (filter === undefined || get.registry.get(searchOpen)) return
    event.preventDefault()
    openPalette(get.registry, filter)
  }
  window.addEventListener("keydown", onKeyDown, { capture: true })
  get.addFinalizer(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
})
