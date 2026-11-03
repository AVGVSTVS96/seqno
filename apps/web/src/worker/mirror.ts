import { Clock, Effect, Latch, Option, Result, SubscriptionRef } from "effect"
import type { BlockId, Page, PageId } from "@seqno/domain"
import { inBackground, type Graph } from "@seqno/graph"
import type { Index } from "@seqno/index"
import {
  classify,
  configPath,
  hasFile,
  mirrorPath,
  preorder,
  printConfig,
  printPage,
  readFileTree,
  sameMeaning,
  type FileTree,
  type LogseqConfig,
  type LogseqSyntax,
} from "@seqno/interop"
import type { MirrorFile, MirrorStatus, MirrorWriter, PageTree } from "@seqno/rpc"
import type { Storage, StorageFailed } from "@seqno/vault"
import type { OpenFile } from "./assets.ts"
import type { FileRecord, KnownText, MirrorStore, MirrorVersion } from "./mirror-store.ts"
import { storageFolder } from "./place.ts"

export interface Outside {
  readonly path: string
  readonly tree: PageTree | null
  readonly disk: FileTree | null
  readonly text: string | null
  readonly texts: ReadonlyArray<KnownText>
  readonly record: FileRecord | null
  readonly parse: (text: string) => Result.Result<FileTree, string>
  readonly render: (tree: PageTree) => string
  readonly faithful: (text: string) => boolean
  readonly restored?: boolean
}

export type Merged =
  | { readonly _tag: "Merged"; readonly page: PageId; readonly ids: ReadonlyArray<BlockId> }
  | { readonly _tag: "Overwrite" }
  | { readonly _tag: "Rewrite" }
  | { readonly _tag: "Deleted" }
  | { readonly _tag: "Left"; readonly reason: string }

export interface MirrorDeps {
  readonly graph: Graph["Service"]
  readonly index: Index["Service"]
  readonly storage: Storage["Service"]
  readonly file: OpenFile
  readonly store: MirrorStore
  readonly config: LogseqConfig
  readonly syntax: LogseqSyntax["Service"]
  readonly indexed: Effect.Effect<void>
  readonly mayWrite: Effect.Effect<boolean>
  readonly writer: Effect.Effect<MirrorWriter | null>
  readonly outside: (change: Outside) => Effect.Effect<Merged>
  readonly baseVersion: Effect.Effect<Option.Option<MirrorVersion>>
  readonly wrote?: (paths: ReadonlyArray<string>) => Effect.Effect<void>
}

export interface Mirror {
  readonly status: SubscriptionRef.SubscriptionRef<MirrorStatus>
  readonly touch: (pages: Iterable<PageId>) => Effect.Effect<void>
  readonly check: (paths?: Iterable<string>) => Effect.Effect<void>
  readonly version: Effect.Effect<Option.Option<MirrorVersion>>
  readonly fileOf: (page: Page) => Effect.Effect<string>
  readonly restore: (path: string, text: string) => Effect.Effect<void, StorageFailed>
  readonly forget: Effect.Effect<void>
  readonly idle: Effect.Effect<boolean>
}

type Done = "done" | "later"

interface MirrorState {
  started: boolean
  reconciled: boolean
  paused: string | null
  counts: Readonly<Record<string, number>>
  pages: ReadonlyMap<string, Page>
  listing: ReadonlySet<string> | null
  forgetting: boolean
}

type Stat =
  | { readonly _tag: "Present"; readonly file: File }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Placeholder" }
  | { readonly _tag: "Failed"; readonly reason: string }

const quietMs = 2000
const maxBackoffMs = 30_000
const keptTexts = 3
const recycleDir = "logseq/.recycle"
const ignoredLines = [
  "updates/",
  "snapshots/",
  "seen/",
  "edit-log/",
  "starter-version",
  "*.crswap",
  "*.seqno-tmp",
]

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const writtenId =
  /(?:^|\n)[ \t]*(?:- |\* )?(?:id::|:id:)[ \t]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

const pathBudgetMs = 300

const unfaithful =
  "has a block seqno can't yet write the way Logseq would read it back, so seqno left the file alone"

const idsWrittenIn = (text: string): ReadonlySet<string> =>
  new Set([...text.matchAll(writtenId)].map((match) => (match[1] ?? "").toLowerCase()))

const ensureFile = (
  storage: Storage["Service"],
  path: string,
  update: (text: string | null) => string | null,
) =>
  Effect.gen(function* () {
    const read = yield* Effect.result(storage.read(path))
    const current = Result.isSuccess(read) ? decoder.decode(read.success) : null
    if (Result.isFailure(read) && read.failure._tag !== "FileUnavailable") return
    if (Result.isFailure(read) && read.failure.reason === "not-downloaded") return
    const next = update(current)
    if (next !== null && next !== current)
      yield* Effect.ignore(storage.write(path, encoder.encode(next)))
  })

export const ignoreSeqnoFiles = (storage: Storage["Service"]) =>
  ensureFile(storage, ".gitignore", (current) => {
    const lines = (current ?? "").split("\n").map((line) => line.trim())
    const missing = ignoredLines.filter((line) => !lines.includes(line))
    if (missing.length === 0) return null
    const base =
      current === null || current === "" ? "" : current.endsWith("\n") ? current : `${current}\n`
    return `${base}${missing.join("\n")}\n`
  })

export const recyclePath = (path: string) => `${recycleDir}/${path.replaceAll("/", "_")}`

const worthAFile = (tree: PageTree): boolean => {
  if (!hasFile(tree)) return false
  const [only, ...rest] = tree.blocks
  return !(
    only !== undefined &&
    rest.length === 0 &&
    only.text.trim() === "" &&
    Object.keys(only.props).length === 0 &&
    Object.keys(tree.page.props).length === 0
  )
}

const orderedIds = (tree: PageTree): ReadonlyArray<BlockId> =>
  preorder(tree.blocks).map((block) => block.id)

const sortedFiles = (files: Map<string, string>): ReadonlyArray<MirrorFile> =>
  [...files]
    .map(([path, reason]) => ({ path, reason }))
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

const stubOf = (path: string) => {
  const slash = path.lastIndexOf("/")
  return `${path.slice(0, slash + 1)}.${path.slice(slash + 1)}.icloud`
}

const readText = (file: File) =>
  Effect.tryPromise({ try: () => file.text(), catch: (cause) => cause }).pipe(
    Effect.map((text) => Option.some(text)),
    Effect.orElseSucceed(() => Option.none<string>()),
  )

export const makeMirror = (deps: MirrorDeps) =>
  Effect.gen(function* () {
    const { graph, storage, store, config, syntax } = deps
    const status = yield* SubscriptionRef.make<MirrorStatus>({
      left: [],
      failed: [],
      paused: null,
      writer: null,
    })
    const wake = yield* Latch.make(false)
    const dirtyPages = new Set<PageId>()
    const dirtyPaths = new Set<string>()
    const byPath = new Map<string, FileRecord>()
    const byPage = new Map<PageId, string>()
    const observed = new Map<string, { size: number; modified: number; at: number }>()
    const backoff = new Map<string, { at: number; delay: number }>()
    const left = new Map<string, string>()
    const restoring = new Set<string>()
    const failed = new Map<string, string>()
    const state: MirrorState = {
      started: false,
      reconciled: false,
      paused: null,
      counts: {},
      pages: new Map(),
      listing: null,
      forgetting: false,
    }

    const folder = storageFolder(storage)

    const parse = (path: string, text: string): Result.Result<FileTree, string> =>
      Option.match(classify(path, config), {
        onNone: () => Result.fail("isn't a page file"),
        onSome: (classified) =>
          Result.isFailure(classified)
            ? Result.fail("isn't a page file")
            : readFileTree(classified.success, text, config, syntax),
      })

    const referenced = (tree: PageTree): ReadonlySet<string> =>
      new Set(
        tree.blocks.flatMap((block) =>
          (state.counts[block.id.toLowerCase()] ?? 0) > 0 ? [block.id.toLowerCase()] : [],
        ),
      )

    const render = (tree: PageTree, disk: string | null) =>
      printPage(syntax, tree, {
        referenced: referenced(tree),
        keepIds: disk === null ? new Set() : idsWrittenIn(disk),
        fileNameFormat: config.fileNameFormat,
      })

    const faithful = (path: string, rendered: string) =>
      Result.match(parse(path, rendered), {
        onFailure: () => false,
        onSuccess: (file) =>
          printPage(syntax, file.tree, {
            referenced: new Set(),
            keepIds: idsWrittenIn(rendered),
            fileNameFormat: config.fileNameFormat,
          }) === rendered,
      })

    const meansSame = (path: string, text: string, tree: PageTree) => {
      const disk = parse(path, text)
      const ours = parse(path, render(tree, text))
      return (
        Result.isSuccess(disk) &&
        Result.isSuccess(ours) &&
        sameMeaning(disk.success.tree, ours.success.tree)
      )
    }

    const stat = (path: string): Effect.Effect<Stat> =>
      deps.file(path).pipe(
        Effect.map((file): Stat => ({ _tag: "Present", file })),
        Effect.catchTag("FileUnavailable", (unavailable) =>
          unavailable.reason === "not-downloaded"
            ? Effect.succeed<Stat>({ _tag: "Placeholder" })
            : Effect.map(Effect.option(deps.file(stubOf(path))), (stub): Stat =>
                Option.isSome(stub) ? { _tag: "Placeholder" } : { _tag: "Missing" },
              ),
        ),
        Effect.catchTag("StorageFailed", (error) =>
          Effect.succeed<Stat>({ _tag: "Failed", reason: error.reason }),
        ),
      )

    const quiet = (path: string, file: File) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const seen = observed.get(path)
        if (seen === undefined || seen.size !== file.size || seen.modified !== file.lastModified) {
          observed.set(path, { size: file.size, modified: file.lastModified, at: now })
          return false
        }
        return now - seen.at >= quietMs
      })

    const goneQuietly = (path: string) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const seen = observed.get(path)
        if (seen === undefined || seen.size !== -1) {
          observed.set(path, { size: -1, modified: -1, at: now })
          return false
        }
        return now - seen.at >= quietMs
      })

    const waiting = (path: string) =>
      Effect.map(Clock.currentTimeMillis, (now) => (backoff.get(path)?.at ?? 0) > now)

    const failedAt = (path: string, reason: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const delay = Math.min(maxBackoffMs, (backoff.get(path)?.delay ?? 500) * 2)
        backoff.set(path, { at: now + delay, delay })
        failed.set(path, reason)
        return "later" as const
      })

    const settled = (path: string) => {
      backoff.delete(path)
      failed.delete(path)
      left.delete(path)
    }

    const mapPath = (path: string, record: FileRecord) => {
      const before = byPath.get(path)
      if (before !== undefined && byPage.get(before.page) === path) byPage.delete(before.page)
      byPath.set(path, record)
      byPage.set(record.page, path)
    }

    const unmap = (path: string) => {
      const record = byPath.get(path)
      byPath.delete(path)
      if (record !== undefined && byPage.get(record.page) === path) byPage.delete(record.page)
    }

    const remember = (
      path: string,
      tree: PageTree,
      text: string,
      file: File,
      ids: ReadonlyArray<BlockId> = orderedIds(tree),
    ) =>
      Effect.gen(function* () {
        const texts = byPath.has(path) ? yield* store.texts(path) : []
        const record: FileRecord = {
          page: tree.page.id,
          name: tree.page.name,
          size: file.size,
          modified: file.lastModified,
        }
        const known = [{ text, ids }, ...texts.filter((one) => one.text !== text)]
        yield* store.put(path, record, known.slice(0, keptTexts))
        mapPath(path, record)
        observed.set(path, { size: file.size, modified: file.lastModified, at: 0 })
        settled(path)
        if (deps.wrote !== undefined) yield* deps.wrote([path])
      })

    const writeFile = (path: string, tree: PageTree, text: string) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const wrote = yield* Effect.result(storage.write(path, encoder.encode(text)))
          if (Result.isFailure(wrote)) return yield* failedAt(path, wrote.failure.reason)
          const after = yield* stat(path)
          if (after._tag !== "Present")
            return yield* failedAt(path, "the file was gone right after seqno wrote it")
          yield* remember(path, tree, text, after.file)
          return "done" as const
        }),
      )

    const recycle = (path: string, texts: ReadonlyArray<KnownText>) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const now = yield* stat(path)
          if (now._tag === "Missing") {
            yield* store.drop(path)
            unmap(path)
            settled(path)
            return "done" as const
          }
          if (now._tag === "Placeholder") {
            yield* Effect.ignore(storage.download(path))
            return "later" as const
          }
          if (now._tag === "Failed") return yield* failedAt(path, now.reason)
          const text = yield* readText(now.file)
          if (Option.isNone(text)) return "later" as const
          if (!texts.some((known) => known.text === text.value)) return "unknown" as const
          const moved = yield* Effect.result(
            Effect.andThen(
              storage.write(recyclePath(path), encoder.encode(text.value)),
              storage.remove(path),
            ),
          )
          if (Result.isFailure(moved)) return yield* failedAt(path, moved.failure.reason)
          yield* store.drop(path)
          unmap(path)
          settled(path)
          if (deps.wrote !== undefined) yield* deps.wrote([path, recyclePath(path)])
          return "done" as const
        }),
      )

    const vanishing = Effect.gen(function* () {
      const listed = state.listing ?? new Set(yield* ownedFiles)
      state.listing = listed
      const gone = [...byPath.keys()].filter((path) => !listed.has(path))
      const folders = [config.pagesDirectory, config.journalsDirectory].filter(
        (dir) =>
          [...byPath.keys()].some((path) => path.startsWith(`${dir}/`)) &&
          ![...listed].some((path) => path.startsWith(`${dir}/`)),
      )
      if (folders.length > 0) {
        return Option.some(
          `seqno stopped writing Logseq's files: the folder ${folders.join(" and ")} is gone, which looks like the graph's folder moved or isn't available. Nothing in seqno was deleted.`,
        )
      }
      if (gone.length >= 3 && gone.length * 5 > byPath.size) {
        return Option.some(
          `seqno stopped writing Logseq's files: ${gone.length} of ${byPath.size} are gone from the folder at once, which looks like the folder moved or isn't available. Nothing in seqno was deleted.`,
        )
      }
      return Option.none()
    })

    const handOutside = (
      found: Omit<Outside, "parse" | "render" | "faithful">,
      file: File | null,
    ): Effect.Effect<Done> =>
      Effect.gen(function* () {
        const change: Outside = {
          ...found,
          parse: (text) => parse(found.path, text),
          render: (tree) => render(tree, found.text),
          faithful: (text) => faithful(found.path, text),
        }
        if (change.text === null) {
          const paused = yield* vanishing
          if (Option.isSome(paused)) {
            state.paused = paused.value
            return "later" as const
          }
        }
        const outcome = yield* deps.outside(change)
        const { path, tree } = change
        switch (outcome._tag) {
          case "Left":
            left.set(path, outcome.reason)
            return "done" as const
          case "Deleted":
            yield* store.drop(path)
            unmap(path)
            settled(path)
            return "done" as const
          case "Rewrite":
            yield* store.drop(path)
            unmap(path)
            if (tree === null) return "done" as const
            return yield* writeFile(path, tree, render(tree, null))
          case "Overwrite":
            if (tree === null) return "done" as const
            return yield* writeFile(path, tree, render(tree, change.text))
          case "Merged": {
            dirtyPages.add(outcome.page)
            const merged = yield* Effect.option(graph.page(outcome.page))
            if (Option.isNone(merged) || file === null || change.text === null)
              return "done" as const
            yield* remember(path, merged.value, change.text, file, outcome.ids)
            return "done" as const
          }
        }
      })

    const processFile = (path: string, tree: PageTree): Effect.Effect<Done> =>
      Effect.gen(function* () {
        if (yield* waiting(path)) return "later"
        const record = byPath.get(path) ?? null
        const now = yield* stat(path)
        if (now._tag === "Placeholder") {
          yield* Effect.ignore(storage.download(path))
          return "later"
        }
        if (now._tag === "Failed") return yield* failedAt(path, now.reason)
        if (now._tag === "Missing") {
          if (record !== null) {
            if (!(yield* goneQuietly(path))) return "later"
            return yield* handOutside(
              { path, tree, disk: null, text: null, texts: yield* store.texts(path), record },
              null,
            )
          }
          if (!worthAFile(tree)) return "done"
          const fresh = render(tree, null)
          if (!faithful(path, fresh)) {
            left.set(path, unfaithful)
            return "done"
          }
          return yield* writeFile(path, tree, fresh)
        }
        const file = now.file
        const texts = record === null ? [] : yield* store.texts(path)
        const unchanged =
          record !== null && record.size === file.size && record.modified === file.lastModified
        const text =
          unchanged && texts[0] !== undefined ? Option.some(texts[0].text) : yield* readText(file)
        if (Option.isNone(text)) {
          yield* Effect.ignore(storage.download(path))
          return "later"
        }
        const disk = text.value
        const rendered = render(tree, disk)
        if (!faithful(path, rendered)) {
          left.set(path, unfaithful)
          return "done"
        }
        const restored = restoring.has(path)
        const known = !restored && texts.some((one) => one.text === disk)
        if (!known) {
          const parsed = parse(path, disk)
          if (
            Result.isSuccess(parsed) &&
            record === null &&
            parsed.success.tree.page.name !== tree.page.name
          ) {
            left.set(
              path,
              `holds the page ${parsed.success.tree.page.title}, not ${tree.page.title}`,
            )
            return "done"
          }
          if (meansSame(path, disk, tree)) {
            restoring.delete(path)
            yield* remember(path, tree, disk, file)
            return "done"
          }
          if (texts.length === 0) {
            const then = yield* pageAtBase(tree.page.id)
            if (Option.isSome(then) && meansSame(path, disk, then.value)) {
              yield* remember(path, then.value, disk, file)
              return yield* writeFile(path, tree, rendered)
            }
          }
          if (!restored && !(yield* quiet(path, file))) return "later"
          restoring.delete(path)
          return yield* handOutside(
            {
              path,
              tree,
              disk: Result.isSuccess(parsed) ? parsed.success : null,
              text: disk,
              texts: restored ? texts.slice(0, 1) : texts,
              record,
              restored,
            },
            file,
          )
        }
        if (rendered === disk || meansSame(path, disk, tree)) {
          settled(path)
          return "done"
        }
        return yield* writeFile(path, tree, rendered)
      })

    const processPage = (id: PageId): Effect.Effect<Done> =>
      Effect.gen(function* () {
        const found = yield* Effect.option(graph.page(id))
        const path = byPage.get(id)
        if (Option.isNone(found)) {
          if (path === undefined) return "done"
          const recycled = yield* recycle(path, yield* store.texts(path))
          if (recycled !== "unknown") return recycled
          left.set(path, "was deleted in seqno, but changed outside seqno, so seqno left it")
          return "done"
        }
        const tree = found.value
        if (path !== undefined) {
          const record = byPath.get(path)
          const moved = mirrorPath(tree.page, config)
          if (record !== undefined && record.name !== tree.page.name && moved !== path) {
            const texts = yield* store.texts(path)
            const written = yield* processNew(moved, tree)
            if (written === "later") return "later"
            const recycled = yield* recycle(path, texts)
            if (recycled === "unknown") {
              left.set(path, `holds ${record.name}, renamed in seqno, and changed outside seqno`)
              unmap(path)
              return "done"
            }
            return recycled
          }
          return yield* processFile(path, tree)
        }
        if (!worthAFile(tree)) return "done"
        return yield* processNew(mirrorPath(tree.page, config), tree)
      })

    const processNew = (path: string, tree: PageTree): Effect.Effect<Done> => {
      const other = byPath.get(path)
      if (other !== undefined && other.page !== tree.page.id) {
        left.set(path, `holds the page ${other.name}, so ${tree.page.title} has no file`)
        return Effect.succeed("done")
      }
      return processFile(path, tree)
    }

    const pageNamed = (name: string) => Option.fromUndefinedOr(state.pages.get(name))

    const processPath = (path: string): Effect.Effect<Done> =>
      Effect.gen(function* () {
        const record = byPath.get(path)
        if (record !== undefined) {
          const tree = yield* Effect.option(graph.page(record.page))
          if (Option.isSome(tree)) return yield* processFile(path, tree.value)
          dirtyPages.add(record.page)
          return "done"
        }
        if (yield* waiting(path)) return "later"
        const now = yield* stat(path)
        if (now._tag === "Missing") return "done"
        if (now._tag === "Placeholder") {
          yield* Effect.ignore(storage.download(path))
          return "later"
        }
        if (now._tag === "Failed") return yield* failedAt(path, now.reason)
        const text = yield* readText(now.file)
        if (Option.isNone(text)) return "later"
        const parsed = parse(path, text.value)
        if (Result.isFailure(parsed)) {
          left.set(path, `couldn't be read: ${parsed.failure}`)
          return "done"
        }
        const page = pageNamed(parsed.success.tree.page.name)
        if (Option.isSome(page)) {
          if (byPage.has(page.value.id)) return "done"
          const tree = yield* Effect.option(graph.page(page.value.id))
          if (Option.isNone(tree)) return "done"
          return yield* processFile(path, tree.value)
        }
        if (!(yield* quiet(path, now.file))) return "later"
        const version = yield* deps.baseVersion
        const [then] = Option.isNone(version)
          ? []
          : yield* graph.pagesAt(
              new Map(Object.entries(version.value)),
              (one) => one.name === parsed.success.tree.page.name,
            )
        if (then !== undefined) return yield* goneFromSeqno(path, then, text.value, now.file)
        return yield* handOutside(
          { path, tree: null, disk: parsed.success, text: text.value, texts: [], record: null },
          now.file,
        )
      })

    const pageAtBase = (id: PageId) =>
      Effect.gen(function* () {
        const version = yield* deps.baseVersion
        if (Option.isNone(version)) return Option.none<PageTree>()
        const at = new Map(Object.entries(version.value))
        const changed = yield* graph.changedSince(at)
        if (Option.isNone(changed)) return Option.none<PageTree>()
        const [then] = yield* graph.pagesAt(at, (page) => page.id === id)
        return Option.fromUndefinedOr(then)
      })

    const goneFromSeqno = (path: string, then: PageTree, text: string, file: File) =>
      Effect.gen(function* () {
        const unchanged = meansSame(path, text, then)
        const now = yield* Effect.option(graph.page(then.page.id))
        if (Option.isSome(now)) {
          if (!unchanged) {
            left.set(path, `holds ${then.page.title}, renamed in seqno, and changed outside seqno`)
            return "done" as const
          }
          yield* remember(path, then, text, file)
          dirtyPages.add(then.page.id)
          return "done" as const
        }
        if (!unchanged) {
          left.set(path, "was deleted in seqno, but changed outside seqno, so seqno left it")
          return "done" as const
        }
        const recycled = yield* recycle(path, [{ text, ids: [] }])
        return recycled === "unknown" ? "later" : recycled
      })

    const ownedFiles = Effect.map(
      Effect.orElseSucceed(folder.list, () => []),
      (files) =>
        files.flatMap((path) =>
          Option.match(classify(path, config), {
            onNone: () => [],
            onSome: (classified) =>
              Result.isSuccess(classified) ? [classified.success.path] : [classified.failure.path],
          }),
        ),
    )

    const prepareFolder = Effect.andThen(
      ensureFile(storage, configPath, (current) => (current === null ? printConfig(config) : null)),
      ignoreSeqnoFiles(storage),
    )

    const start = Effect.gen(function* () {
      yield* deps.indexed
      const records = yield* store.records
      for (const [path, record] of records) mapPath(path, record)
      const version = yield* store.version
      const changed = Option.isNone(version)
        ? Option.none()
        : yield* graph.changedSince(new Map(Object.entries(version.value)))
      const pages = yield* graph.pages
      if (Option.isSome(changed)) {
        changed.value.pages.forEach((page) => dirtyPages.add(page))
        for (const record of records.values()) {
          if (!pages.some((page) => page.id === record.page)) dirtyPages.add(record.page)
        }
      } else {
        pages.forEach((page) => dirtyPages.add(page.id))
        records.forEach((record) => dirtyPages.add(record.page))
      }
      for (const path of yield* ownedFiles) dirtyPaths.add(path)
      records.forEach((_, path) => dirtyPaths.add(path))
      yield* prepareFolder
      state.started = true
    })

    const publish = Effect.gen(function* () {
      const writer = yield* deps.writer
      const next: MirrorStatus = {
        left: sortedFiles(left),
        failed: sortedFiles(failed),
        paused: state.paused,
        writer,
      }
      const current = yield* SubscriptionRef.get(status)
      if (JSON.stringify(current) !== JSON.stringify(next)) yield* SubscriptionRef.set(status, next)
    })

    const pass = Effect.gen(function* () {
      if (!(yield* deps.mayWrite)) {
        yield* publish
        return false
      }
      if (state.forgetting) {
        state.forgetting = false
        state.started = false
        state.reconciled = false
        for (const each of [byPath, byPage, observed, backoff, left, failed]) each.clear()
        yield* store.clear
      }
      if (!state.started) yield* start
      state.listing = null
      if (state.paused !== null) {
        const still = yield* vanishing
        state.paused = Option.getOrNull(still)
        if (state.paused !== null) {
          yield* publish
          return true
        }
      }
      const begun = yield* graph.version
      state.counts = yield* Effect.orElseSucceed(deps.index.blockRefCounts, () => ({}))
      state.pages = new Map((yield* graph.pages).map((page) => [page.name, page]))
      const expected = new Set(
        [...state.pages.values()].flatMap((page) =>
          dirtyPages.has(page.id) && !byPage.has(page.id) ? [mirrorPath(page, config)] : [],
        ),
      )
      const paths = [...dirtyPaths].toSorted(
        (a, b) => Number(expected.has(b)) - Number(expected.has(a)),
      )
      dirtyPaths.clear()
      let later = false
      const until = (yield* Clock.currentTimeMillis) + pathBudgetMs
      for (const path of paths) {
        if ((yield* Clock.currentTimeMillis) > until) {
          dirtyPaths.add(path)
          later = true
          continue
        }
        if ((yield* processPath(path)) === "later") {
          dirtyPaths.add(path)
          later = true
        }
      }
      if (!state.reconciled && !later) state.reconciled = true
      const pages = [...dirtyPages]
      dirtyPages.clear()
      for (const page of pages) {
        if (!state.reconciled && !byPage.has(page)) {
          dirtyPages.add(page)
          continue
        }
        if ((yield* processPage(page)) === "later") {
          dirtyPages.add(page)
          later = true
        }
      }
      yield* publish
      if (dirtyPages.size === 0 && dirtyPaths.size === 0 && failed.size === 0) {
        yield* store.setVersion(Object.fromEntries(begun))
      }
      return later || dirtyPages.size > 0 || dirtyPaths.size > 0
    })

    const loop = Effect.forever(
      Effect.gen(function* () {
        yield* wake.await
        yield* Effect.sleep("1 second")
        yield* wake.close
        const more = yield* inBackground(
          Effect.catchCause(pass, (cause) => Effect.as(Effect.logError(cause), true)),
        )
        if (more) yield* wake.open
      }),
    )

    const mirror: Mirror = {
      status,
      touch: (pages) =>
        Effect.suspend(() => {
          for (const page of pages) dirtyPages.add(page)
          return dirtyPages.size > 0 ? wake.open : Effect.void
        }),
      check: (paths) =>
        Effect.gen(function* () {
          const listed =
            paths === undefined
              ? [...(yield* ownedFiles), ...byPath.keys()]
              : [...paths].filter(
                  (path) => byPath.has(path) || Option.isSome(classify(path, config)),
                )
          for (const path of listed) dirtyPaths.add(path)
          yield* wake.open
        }),
      version: store.version,
      fileOf: (page) => Effect.sync(() => byPage.get(page.id) ?? mirrorPath(page, config)),
      restore: (path, text) =>
        Effect.gen(function* () {
          restoring.add(path)
          yield* Effect.tapError(storage.write(path, encoder.encode(text)), () =>
            Effect.sync(() => restoring.delete(path)),
          )
          dirtyPaths.add(path)
          yield* wake.open
        }),
      idle: Effect.sync(
        () =>
          state.started &&
          state.reconciled &&
          state.paused === null &&
          dirtyPages.size === 0 &&
          dirtyPaths.size === 0 &&
          failed.size === 0,
      ),
      forget: Effect.suspend(() => {
        state.forgetting = true
        return wake.open
      }),
    }
    return { mirror, loop: Effect.andThen(wake.open, loop) }
  })
