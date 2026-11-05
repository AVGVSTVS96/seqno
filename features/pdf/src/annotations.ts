import { Effect, Option, Schema } from "effect"
import { AtomRegistry, Reactivity } from "effect/reactivity"
import { BlockId, normalizePageName } from "@seqno/domain"
import type { Block, BlockDraft, Command, GraphEvent, Page } from "@seqno/domain"
import { coreRuntime, pageListKey } from "@seqno/outliner"
import { CoreClient } from "@seqno/rpc"
import { isArea } from "./highlights.ts"
import type { Highlight } from "./highlights.ts"
import { annotationProps, hlsPageProps, hlsPageTitle } from "./model.ts"
import type { PdfAsset } from "./model.ts"

const isBlockId = Schema.is(BlockId)

let queue: Promise<unknown> = Promise.resolve()

export const runCore = async <A, E>(
  registry: AtomRegistry.AtomRegistry,
  effect: Effect.Effect<A, E, CoreClient>,
): Promise<A> => {
  const run = async () =>
    await Effect.runPromise(
      Effect.flatMap(AtomRegistry.getResult(registry, coreRuntime), (context) =>
        Effect.provide(effect, context),
      ),
    )

  const next = queue.then(run, run)
  queue = next.catch(() => {})

  return await next
}

const dispatch = (commands: readonly Command[]) =>
  Effect.flatMap(CoreClient, (client) => client.DispatchAll({ commands })).pipe(
    Effect.tap((events: readonly GraphEvent[]) =>
      events.some((event) => event._tag === "PageUpserted")
        ? Effect.flatMap(Effect.serviceOption(Reactivity.Reactivity), (reactivity) =>
            Option.isSome(reactivity) ? reactivity.value.invalidate(pageListKey) : Effect.void,
          )
        : Effect.void,
    ),
  )

export const pageNamed = (name: string) =>
  Effect.flatMap(CoreClient, (client) =>
    Effect.map(client.GetPages(), (pages) =>
      Option.fromNullishOr(pages.find((page) => page.name === normalizePageName(name))),
    ),
  )

export const blockOf = (id: string) =>
  Effect.flatMap(CoreClient, (client) =>
    client.GetBlockByRef({ uuid: id }).pipe(
      Effect.map(Option.some),
      Effect.catchTag("BlockRefNotFound", () => Effect.succeed(Option.none<Block>())),
    ),
  )

export const ensureRefPage = (asset: PdfAsset) =>
  Effect.gen(function* () {
    const found = yield* pageNamed(hlsPageTitle(asset.key))

    if (Option.isSome(found)) {
      const page = found.value

      if (page.props["file-path"] === asset.originalPath) {
        return page
      }

      yield* dispatch([
        {
          _tag: "SetProperty",
          target: { _tag: "PageTarget", pageId: page.id },
          key: "file-path",
          value: asset.originalPath,
        },
      ])

      return page
    }

    const events = yield* dispatch([
      { _tag: "CreatePage", title: hlsPageTitle(asset.key), props: hlsPageProps(asset, false) },
    ])

    const made = events.flatMap((event): readonly Page[] =>
      event._tag === "PageUpserted" ? [event.page] : [],
    )[0]

    return (
      made ?? (yield* Effect.die(new Error(`couldn't make the page ${hlsPageTitle(asset.key)}`)))
    )
  })

export const ensureRefBlock = (asset: PdfAsset, highlight: Highlight) =>
  Effect.gen(function* () {
    const page = yield* ensureRefPage(asset)
    const existing = yield* blockOf(highlight.id)

    if (Option.isSome(existing)) {
      return existing.value
    }

    const client = yield* CoreClient
    const tree = yield* client.GetPage({ pageId: page.id })
    const last = tree.blocks.findLast((block) => block.parentId === null)

    const fields = {
      text: highlight.content.text ?? "",
      props: annotationProps(highlight),
      children: [],
    }

    const draft: BlockDraft = isBlockId(highlight.id) ? { ...fields, id: highlight.id } : fields

    const insert = {
      _tag: "InsertBlocks",
      pageId: page.id,
      parentId: null,
      blocks: [draft],
    } as const

    const events = yield* dispatch([last === undefined ? insert : { ...insert, after: last.id }])

    const made = events.flatMap((event): readonly Block[] =>
      event._tag === "BlockUpserted" ? [event.block] : [],
    )[0]

    return made ?? (yield* Effect.die(new Error("couldn't make the annotation block")))
  })

export const updateRefBlock = (highlight: Highlight, now: number) =>
  Effect.gen(function* () {
    const found = yield* blockOf(highlight.id)

    if (Option.isNone(found)) {
      return
    }

    const target = { _tag: "BlockTarget", blockId: found.value.id } as const
    yield* dispatch([
      {
        _tag: "SetProperty",
        target,
        key: "hl-stamp",
        value: String(isArea(highlight) ? (highlight.content.image ?? now) : now),
      },
      { _tag: "SetProperty", target, key: "hl-color", value: highlight.properties.color ?? "" },
    ])
  })

export const deleteRefBlock = (highlight: Highlight) =>
  Effect.gen(function* () {
    const found = yield* blockOf(highlight.id)

    if (Option.isSome(found)) {
      yield* dispatch([{ _tag: "DeleteBlocks", blockIds: [found.value.id] }])
    }
  })
