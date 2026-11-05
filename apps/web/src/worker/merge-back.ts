import { Crypto, Effect, Option, Result } from "effect"
import { BlockId, newBlockId } from "@seqno/domain"
import type { Block, Command, GraphEvent, PageId } from "@seqno/domain"
import type { Graph } from "@seqno/graph"
import { diff, draftsOf, explicitId, mergePage, preorder, sameMeaning } from "@seqno/interop"
import type { FileTree } from "@seqno/interop"
import type { PageTree } from "@seqno/rpc"
import type { Merged, Outside } from "./mirror.ts"
import type { MirrorVersion } from "./mirror-store.ts"

export interface MergeBackDeps {
  readonly graph: Graph["Service"]
  readonly record: (
    change: Effect.Effect<readonly GraphEvent[], unknown>,
  ) => Effect.Effect<readonly GraphEvent[], unknown>
  readonly blocks: (ids: readonly BlockId[]) => Effect.Effect<readonly Block[]>
  readonly synced: boolean
  readonly baseVersion: Effect.Effect<Option.Option<MirrorVersion>>
}

const client = "mirror"

const lines = (text: string) => text.split("\n")

const distance = (a: string, b: string) =>
  diff(lines(a), lines(b)).filter((edit) => edit._tag !== "Same").length

const reasonOf = (error: unknown) =>
  typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : String(error)

const leave = (reason: string): Merged => ({ _tag: "Left", reason })

const emptyAt = (tree: PageTree): PageTree => ({ page: tree.page, blocks: [] })

export const makeMergeBack =
  (deps: MergeBackDeps) =>
  (change: Outside): Effect.Effect<Merged, never, Crypto.Crypto> =>
    Effect.gen(function* () {
      const { graph } = deps
      const { tree, text, disk } = change

      if (!deps.synced && change.restored !== true) {
        if (tree === null) {
          return leave("isn't a page in seqno")
        }

        return text === null ? { _tag: "Rewrite" } : { _tag: "Overwrite" }
      }

      const dispatch = (commands: readonly Command[]) =>
        Effect.result(deps.record(graph.dispatchAll(commands, client)))

      const reconciled = (page: PageTree) =>
        Effect.gen(function* () {
          const version = yield* deps.baseVersion

          if (Option.isNone(version)) {
            return Option.none<PageTree>()
          }

          const at = new Map(Object.entries(version.value))
          const changed = yield* graph.changedSince(at)

          if (Option.isNone(changed)) {
            return Option.none<PageTree>()
          }

          if (!changed.value.pages.has(page.page.id)) {
            return Option.some(page)
          }

          const [then] = yield* graph.pagesAt(at, (found) => found.id === page.page.id)

          return Option.some(then ?? emptyAt(page))
        })

      if (text === null) {
        if (tree === null) {
          return { _tag: "Deleted" }
        }

        const latest = change.texts[0]

        const unchanged =
          latest === undefined
            ? Option.match(yield* reconciled(tree), {
                onNone: () => false,
                onSome: (then) => sameMeaning(then, tree),
              })
            : Result.match(change.parse(latest.text), {
                onFailure: () => false,
                onSuccess: (base) =>
                  Result.match(change.parse(change.render(tree)), {
                    onFailure: () => false,
                    onSuccess: (now) => sameMeaning(base.tree, now.tree),
                  }),
              })

        if (!unchanged) {
          return { _tag: "Rewrite" }
        }

        const deleted = yield* dispatch([{ _tag: "DeletePage", pageId: tree.page.id }])

        return Result.isSuccess(deleted)
          ? { _tag: "Deleted" }
          : leave(
              `was deleted outside seqno, and its page couldn't be: ${reasonOf(deleted.failure)}`,
            )
      }

      if (disk === null) {
        return leave("couldn't be read as a Logseq page")
      }

      const minted: BlockId[] = yield* Effect.forEach(
        Array.from({ length: disk.tree.blocks.length + 16 }),
        () => Effect.orDie(newBlockId),
      )

      const spare = { at: 0 }
      const mint = () => minted[spare.at++] ?? BlockId.make(crypto.randomUUID())

      const written = disk.tree.blocks.flatMap((block) =>
        Option.toArray(Option.liftThrowable(BlockId.make)(explicitId(disk, block) ?? "")),
      )

      const onPage = new Set<string>(tree?.blocks.map((block) => block.id) ?? [])
      const elsewhere = yield* deps.blocks(written.filter((id) => !onPage.has(id)))
      const taken = new Set<string>(elsewhere.map((block) => block.id))

      if (tree === null) {
        const { page } = disk.tree

        const created = yield* dispatch([
          {
            _tag: "CreatePage",
            title: page.title,
            ...(page.journalDay === null ? {} : { journalDay: page.journalDay }),
            ...(Object.keys(page.props).length === 0 ? {} : { props: page.props }),
            ...(page.format === undefined ? {} : { format: page.format }),
          },
        ])

        if (Result.isFailure(created)) {
          return leave(
            `is a new page outside seqno that seqno couldn't add: ${reasonOf(created.failure)}`,
          )
        }

        const pageId = created.success.flatMap((event): readonly PageId[] =>
          event._tag === "PageUpserted" && event.page.name === page.name ? [event.page.id] : [],
        )[0]

        if (pageId === undefined) {
          return leave("is a new page outside seqno that seqno couldn't add")
        }

        const { drafts, collapsed, ids } = draftsOf(disk, mint, taken)
        const [first, ...rest] = drafts

        if (first !== undefined) {
          const filled = yield* dispatch([
            { _tag: "InsertBlocks", pageId, parentId: null, blocks: [first, ...rest] },
            ...collapsed.map((blockId): Command => ({
              _tag: "SetCollapsed",
              blockId,
              collapsed: true,
            })),
          ])

          if (Result.isFailure(filled)) {
            return leave(
              `is a new page outside seqno whose blocks seqno couldn't add: ${reasonOf(filled.failure)}`,
            )
          }
        }

        return { _tag: "Merged", page: pageId, ids }
      }

      const known = change.texts.toSorted(
        (a, b) => distance(a.text, text) - distance(b.text, text),
      )[0]

      const base = Option.isSome(Option.fromUndefinedOr(known))
        ? Result.match(change.parse(known?.text ?? ""), {
            onFailure: () => Option.none<{ file: FileTree; ids: readonly BlockId[] }>(),
            onSuccess: (file) => Option.some({ file, ids: known?.ids ?? [] }),
          })
        : Option.flatMap(
            Option.filter(yield* reconciled(tree), (then) => change.faithful(change.render(then))),
            (then) =>
              Result.match(change.parse(change.render(then)), {
                onFailure: () => Option.none<{ file: FileTree; ids: readonly BlockId[] }>(),
                onSuccess: (file) =>
                  Option.some({ file, ids: preorder(then.blocks).map((block) => block.id) }),
              }),
          )

      if (Option.isNone(base)) {
        return leave("changed outside seqno, and seqno can't tell what it last wrote there")
      }

      const { batches, ids } = mergePage({ base: base.value, disk, page: tree, mint, taken })

      for (const batch of batches) {
        const applied = yield* dispatch(batch)

        if (Result.isFailure(applied)) {
          return leave(`changed outside seqno and couldn't be merged: ${reasonOf(applied.failure)}`)
        }
      }

      return { _tag: "Merged", page: tree.page.id, ids }
    })
