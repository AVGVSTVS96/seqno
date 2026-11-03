import { Effect, Option, Schema } from "effect"
import { BlockId, PageId } from "@seqno/domain"

export const KnownText = Schema.Struct({ text: Schema.String, ids: Schema.Array(BlockId) })
export type KnownText = typeof KnownText.Type

export const FileRecord = Schema.Struct({
  page: PageId,
  name: Schema.String,
  size: Schema.Number,
  modified: Schema.Number,
})
export type FileRecord = typeof FileRecord.Type

export const MirrorVersion = Schema.Record(Schema.String, Schema.Int)
export type MirrorVersion = typeof MirrorVersion.Type

export interface MirrorStore {
  readonly records: Effect.Effect<ReadonlyMap<string, FileRecord>>
  readonly texts: (path: string) => Effect.Effect<ReadonlyArray<KnownText>>
  readonly put: (
    path: string,
    record: FileRecord,
    texts: ReadonlyArray<KnownText>,
  ) => Effect.Effect<void>
  readonly drop: (path: string) => Effect.Effect<void>
  readonly version: Effect.Effect<Option.Option<MirrorVersion>>
  readonly setVersion: (version: MirrorVersion) => Effect.Effect<void>
  readonly clear: Effect.Effect<void>
}

export const memoryMirrorStore = (): MirrorStore => {
  const records = new Map<string, FileRecord>()
  const texts = new Map<string, ReadonlyArray<KnownText>>()
  const state = { version: Option.none<MirrorVersion>() }
  return {
    records: Effect.sync(() => new Map(records)),
    texts: (path) => Effect.sync(() => texts.get(path) ?? []),
    put: (path, record, known) =>
      Effect.sync(() => {
        records.set(path, record)
        texts.set(path, known)
      }),
    drop: (path) =>
      Effect.sync(() => {
        records.delete(path)
        texts.delete(path)
      }),
    version: Effect.sync(() => state.version),
    setVersion: (version) =>
      Effect.sync(() => {
        state.version = Option.some(version)
      }),
    clear: Effect.sync(() => {
      records.clear()
      texts.clear()
      state.version = Option.none()
    }),
  }
}

const StoredRecord = Schema.Struct({
  graph: Schema.String,
  path: Schema.String,
  record: FileRecord,
})
const StoredTexts = Schema.Struct({ texts: Schema.Array(KnownText) })
const StoredVersion = Schema.Struct({ version: MirrorVersion })

const decodeRecords = Schema.decodeUnknownOption(Schema.Array(StoredRecord))
const decodeTexts = Schema.decodeUnknownOption(StoredTexts)
const decodeVersion = Schema.decodeUnknownOption(StoredVersion)

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open("seqno-mirror", 1)
    opening.addEventListener("upgradeneeded", () => {
      const records = opening.result.createObjectStore("records", { keyPath: ["graph", "path"] })
      records.createIndex("graph", "graph")
      opening.result.createObjectStore("texts")
      opening.result.createObjectStore("versions")
    })
    opening.addEventListener("success", () => resolve(opening.result))
    opening.addEventListener("error", () =>
      reject(opening.error ?? new Error("IndexedDB open failed")),
    )
  })

const opened: { database?: Promise<IDBDatabase> } = {}

const database = Effect.promise(() => {
  opened.database ??= openDatabase()
  return opened.database
})

type StoreName = "records" | "texts" | "versions"

const run = <A>(
  names: ReadonlyArray<StoreName>,
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction, done: (value: A) => void) => void,
) =>
  Effect.flatMap(database, (db) =>
    Effect.callback<A>((resume) => {
      const transaction = db.transaction(names, mode)
      const result: { value?: A } = {}
      body(transaction, (value) => {
        result.value = value
      })
      transaction.addEventListener("complete", () =>
        resume(
          "value" in result
            ? Effect.succeed(result.value)
            : Effect.die(new Error("IndexedDB gave no result")),
        ),
      )
      transaction.addEventListener("error", () =>
        resume(Effect.die(transaction.error ?? new Error("IndexedDB request failed"))),
      )
      transaction.addEventListener("abort", () =>
        resume(Effect.die(transaction.error ?? new Error("IndexedDB request aborted"))),
      )
    }),
  )

const read = (name: StoreName, query: (store: IDBObjectStore) => IDBRequest) =>
  run<unknown>([name], "readonly", (transaction, done) => {
    const request = query(transaction.objectStore(name))
    request.addEventListener("success", () => done(request.result))
  })

export const indexedDbMirrorStore = (graph: string): MirrorStore => ({
  records: Effect.map(
    read("records", (records) => records.index("graph").getAll(IDBKeyRange.only(graph))),
    (rows) =>
      Option.match(decodeRecords(rows), {
        onNone: () => new Map<string, FileRecord>(),
        onSome: (decoded) => new Map(decoded.map((row) => [row.path, row.record])),
      }),
  ),
  texts: (path) =>
    Effect.map(
      read("texts", (texts) => texts.get([graph, path])),
      (row) => Option.match(decodeTexts(row), { onNone: () => [], onSome: (found) => found.texts }),
    ),
  put: (path, record, texts) =>
    run<void>(["records", "texts"], "readwrite", (transaction, done) => {
      transaction.objectStore("records").put({ graph, path, record })
      transaction.objectStore("texts").put({ texts }, [graph, path])
      done(undefined)
    }),
  drop: (path) =>
    run<void>(["records", "texts"], "readwrite", (transaction, done) => {
      transaction.objectStore("records").delete([graph, path])
      transaction.objectStore("texts").delete([graph, path])
      done(undefined)
    }),
  version: Effect.map(
    read("versions", (versions) => versions.get(graph)),
    (row) => Option.map(decodeVersion(row), (found) => found.version),
  ),
  setVersion: (version) =>
    run<void>(["versions"], "readwrite", (transaction, done) => {
      transaction.objectStore("versions").put({ version }, graph)
      done(undefined)
    }),
  clear: run<void>(["records", "texts", "versions"], "readwrite", (transaction, done) => {
    const records = transaction.objectStore("records")
    const texts = transaction.objectStore("texts")
    const listing = records.index("graph").getAllKeys(IDBKeyRange.only(graph))
    listing.addEventListener("success", () => {
      for (const key of listing.result) {
        records.delete(key)
        texts.delete(key)
      }
      transaction.objectStore("versions").delete(graph)
      done(undefined)
    })
  }),
})
