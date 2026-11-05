import { Cause, Clock, Effect, Option, Schema, Stream } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  allPagesPublic,
  namesLinked,
  publicPages,
  publicSite,
  publishedReferences,
  publishedRows,
  queriesIn,
  usedAssets,
  zipSite,
} from "@seqno/export"
import type { Published, SiteFile } from "@seqno/export"
import { CoreClient, PageClient } from "@seqno/rpc"
import { readPropertyConfig } from "@seqno/syntax"
import { openGraph, resolvedTheme } from "../../atoms.ts"
import { graphTitle, GraphLocations } from "../../graph-locations.ts"
import { viewRuntime } from "../pages/atoms.ts"
import { notify } from "./Notices.tsx"

export class PublishFailed extends Schema.TaggedError<PublishFailed>()("PublishFailed", {
  reason: Schema.String,
}) {}

const strFromU8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const failed = (cause: unknown) =>
  new PublishFailed({ reason: cause instanceof Error ? cause.message : String(cause) })

const viewerBase = `${import.meta.env.BASE_URL}publish/`

const fetched = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${viewerBase}${path}`)

      if (!response.ok) {
        throw new Error(`The site viewer is missing ${path}`)
      }

      return new Uint8Array(await response.arrayBuffer())
    },
    catch: failed,
  })

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(Schema.String)),
)

const viewerFiles = Effect.gen(function* () {
  const paths = yield* Effect.mapError(
    decodeManifest(strFromU8(yield* fetched("files.json"))),
    failed,
  )

  return yield* Effect.forEach(
    paths,
    (path) => Effect.map(fetched(path), (bytes): SiteFile => [path, bytes]),
    { concurrency: 4 },
  )
})

const first = <A, E>(stream: Stream.Stream<A, E>, fallback: A) =>
  Effect.map(
    Stream.runHead(stream),
    Option.getOrElse(() => fallback),
  )

export type Delivered =
  | { readonly _tag: "Folder"; readonly name: string }
  | { readonly _tag: "Zip" }
  | { readonly _tag: "Nothing"; readonly reason: string }

const writeFolder = (folder: FileSystemDirectoryHandle, files: readonly SiteFile[]) =>
  Effect.tryPromise({
    try: async () => {
      for (const [path, bytes] of files) {
        const parts = path.split("/")
        const name = parts.pop() ?? path
        let at = folder

        for (const part of parts) {
          at = await at.getDirectoryHandle(part, { create: true })
        }

        const writable = await (await at.getFileHandle(name, { create: true })).createWritable()
        await writable.write(new Uint8Array(bytes))
        await writable.close()
      }
    },
    catch: failed,
  })

const pickFolder = Effect.tryPromise({
  try: async () => await window.showDirectoryPicker({ id: "seqno-publish", mode: "readwrite" }),
  catch: (cause) => cause,
}).pipe(
  Effect.map(Option.some),
  Effect.catch((error) =>
    error instanceof DOMException && error.name === "AbortError"
      ? Effect.succeed(Option.none<FileSystemDirectoryHandle>())
      : Effect.fail(failed(error)),
  ),
)

const download = (bytes: Uint8Array, name: string) => {
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/zip" }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

export const reasonOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)

  return typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : String(error)
}

export const publishPages = viewRuntime.fn((_: void, get) =>
  Effect.gen(function* () {
    const graph = Option.match(AsyncResult.value(get(openGraph)), {
      onNone: () => "graph",
      onSome: (opened) => opened.graph,
    })

    const core = yield* CoreClient
    const pagesClient = yield* PageClient
    const locations = yield* GraphLocations

    const text = (path: string) =>
      Effect.map(locations.file(graph, path), (bytes) => (bytes === null ? "" : strFromU8(bytes)))

    const trees = yield* core.ExportPages({})
    const configEdn = yield* text("logseq/config.edn")
    const chosen = publicPages(trees, allPagesPublic(configEdn))

    if (chosen.length === 0) {
      return {
        _tag: "Nothing",
        reason: "No page is public. Add public:: true to the pages to publish.",
      } satisfies Delivered
    }

    const stats = new Map(
      (yield* first(pagesClient.WatchPageStats(), [])).map((stat) => [stat.pageId, stat]),
    )

    const linked = namesLinked(chosen)

    const referencedTitles = new Map(
      (yield* first(pagesClient.WatchReferencedPages(), [])).map((page) => [page.name, page.title]),
    )

    const pageReferences = yield* Effect.forEach(
      chosen,
      ({ page }) =>
        Effect.map(first(pagesClient.WatchReferences({ pageId: page.id }), []), (found) => [
          page.name,
          publishedReferences(chosen, found),
        ]),
      { concurrency: 8 },
    )

    const nameReferences = yield* Effect.forEach(
      linked,
      ({ name }) =>
        Effect.map(first(pagesClient.WatchNameReferences({ name }), []), (found) => [
          name,
          publishedReferences(chosen, found),
        ]),
      { concurrency: 8 },
    )

    const queries = yield* Effect.forEach(
      queriesIn(chosen),
      (query) =>
        core.WatchQuery({ query }).pipe(
          Stream.runHead,
          Effect.map(Option.map((rows) => [query, publishedRows(chosen, rows)] as const)),
          Effect.orElseSucceed(() => Option.none()),
        ),
      { concurrency: 4 },
    )

    const data: Published = {
      graph: graphTitle(graph),
      theme: get(resolvedTheme),
      pages: chosen.map(({ page, blocks }) => ({
        page,
        blocks,
        created: stats.get(page.id)?.created ?? null,
        updated: stats.get(page.id)?.updated ?? null,
      })),
      referenced: linked.map(({ name, title }) => ({
        name,
        title:
          trees.find((tree) => tree.page.name === name)?.page.title ??
          referencedTitles.get(name) ??
          title,
      })),
      references: Object.fromEntries([...pageReferences, ...nameReferences]),
      queries: Object.fromEntries(queries.flatMap(Option.toArray)),
      listKeys: [...readPropertyConfig(configEdn).listKeys],
    }

    const assets = yield* Effect.forEach(usedAssets(chosen), (path) =>
      Effect.map(locations.file(graph, path), (bytes): readonly SiteFile[] =>
        bytes === null ? [] : [[path, bytes]],
      ),
    )

    const files = publicSite(
      data,
      yield* viewerFiles,
      {
        customCss: yield* text("logseq/custom.css"),
        exportCss: yield* text("logseq/export.css"),
        customJs: yield* text("logseq/custom.js"),
      },
      assets.flat(),
    )

    if (typeof window.showDirectoryPicker !== "function") {
      const seconds = Math.floor((yield* Clock.currentTimeMillis) / 1000)
      const folder = `${graph}_public_${seconds}`
      yield* Effect.sync(() => {
        download(zipSite(folder, files, seconds), `${folder}.zip`)
      })

      return { _tag: "Zip" } satisfies Delivered
    }

    const folder = yield* pickFolder

    if (Option.isNone(folder)) {
      return { _tag: "Nothing", reason: "" } satisfies Delivered
    }

    yield* writeFolder(folder.value, files)

    return { _tag: "Folder", name: folder.value.name } satisfies Delivered
  }).pipe(
    Effect.tap((delivered) =>
      Effect.sync(() => {
        if (delivered._tag === "Folder") {
          notify(
            get.registry,
            `Export public pages and publish assets to ${delivered.name} successfully`,
          )
        }

        if (delivered._tag === "Nothing" && delivered.reason !== "") {
          notify(get.registry, delivered.reason)
        }
      }),
    ),
    Effect.tapCause((cause) =>
      Effect.sync(() => {
        notify(get.registry, `Export public pages failed: ${reasonOf(cause)}`)
      }),
    ),
  ),
)
