import { Effect, Semaphore, SubscriptionRef } from "effect"
import { AssetFailed } from "@seqno/rpc"
import type { Asset } from "@seqno/rpc"
import { assetPathOf, assetsFolder } from "@seqno/syntax"
import { Entry } from "@seqno/vault"
import type { FileUnavailable, Storage, StorageFailed } from "@seqno/vault"

export type OpenFile = (path: string) => Effect.Effect<File, StorageFailed | FileUnavailable>

export interface AssetFiles {
  readonly listed: SubscriptionRef.SubscriptionRef<readonly Asset[]>
  readonly save: (name: string, data: Uint8Array) => Effect.Effect<Asset, AssetFailed>
  readonly write: (path: string, data: Uint8Array) => Effect.Effect<Asset, AssetFailed>
  readonly remove: (path: string) => Effect.Effect<void, AssetFailed>
  readonly refresh: Effect.Effect<void>
}

const failed = (path: string) => (error: { readonly _tag: string }) =>
  new AssetFailed({ path, reason: "reason" in error ? String(error.reason) : error._tag })

const splitName = (name: string) => {
  const dot = name.lastIndexOf(".")

  return dot <= 0 ? { stem: name, ext: "" } : { stem: name.slice(0, dot), ext: name.slice(dot) }
}

const sorted = (assets: Iterable<Asset>) =>
  [...assets].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

const filesUnder = (storage: Storage["Service"], dir: string): Effect.Effect<readonly string[]> =>
  storage.list(dir).pipe(
    Effect.orElseSucceed((): readonly Entry[] => []),
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) =>
        Entry.$match(entry, {
          File: ({ name, placeholder }) =>
            placeholder
              ? Effect.as(Effect.ignore(storage.download(`${dir}/${name}`)), [])
              : Effect.succeed([`${dir}/${name}`]),
          Directory: ({ name }) => filesUnder(storage, `${dir}/${name}`),
        }),
      ),
    ),
    Effect.map((nested) => nested.flat()),
  )

const freeName = (name: string, taken: (path: string) => boolean) => {
  const { stem, ext } = splitName(name.replaceAll("/", "_"))
  let path = `${assetsFolder}/${stem}${ext}`

  for (let n = 1; taken(path); n += 1) {
    path = `${assetsFolder}/${stem}_${n}${ext}`
  }

  return path
}

export const makeAssetFiles = (
  storage: Storage["Service"],
  open: OpenFile,
  wrote: (paths: readonly string[]) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const known = new Map<string, Asset>()
    const listed = yield* SubscriptionRef.make<readonly Asset[]>([])
    const lock = yield* Semaphore.make(1)

    const forget = (path: string) => {
      const asset = known.get(path)

      if (asset !== undefined) {
        URL.revokeObjectURL(asset.url)
      }

      known.delete(path)
    }

    const remember = (path: string) =>
      Effect.map(open(path), (file): Asset => {
        forget(path)

        const asset = {
          path,
          url: URL.createObjectURL(file),
          size: file.size,
          modified: file.lastModified,
        }

        known.set(path, asset)

        return asset
      })

    const publish = Effect.suspend(() => SubscriptionRef.set(listed, sorted(known.values())))

    const refresh = lock.withPermit(
      Effect.gen(function* () {
        const present = new Set(yield* filesUnder(storage, assetsFolder))
        const gone = [...known.keys()].filter((path) => !present.has(path))
        const fresh = [...present].filter((path) => !known.has(path))

        if (gone.length === 0 && fresh.length === 0) {
          return
        }

        for (const path of gone) {
          forget(path)
        }

        yield* Effect.forEach(fresh, (path) => Effect.ignore(remember(path)), { discard: true })
        yield* publish
      }),
    )

    const put = (path: string, data: Uint8Array) =>
      Effect.mapError(storage.write(path, data), failed(path)).pipe(
        Effect.andThen(Effect.mapError(remember(path), failed(path))),
        Effect.tap(() => Effect.andThen(publish, wrote([path]))),
      )

    const files: AssetFiles = {
      listed,
      refresh,
      save: (name, data) =>
        lock.withPermit(
          Effect.suspend(() =>
            put(
              freeName(name, (path) => known.has(path)),
              data,
            ),
          ),
        ),
      write: (path, data) => {
        const safe = assetPathOf(path)

        return safe === null
          ? Effect.fail(new AssetFailed({ path, reason: "not a path inside assets/" }))
          : lock.withPermit(put(safe, data))
      },
      remove: (path) => {
        const safe = assetPathOf(path)

        return safe === null
          ? Effect.fail(new AssetFailed({ path, reason: "not a path inside assets/" }))
          : lock.withPermit(
              Effect.mapError(storage.remove(safe), failed(safe)).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    forget(safe)
                  }),
                ),
                Effect.andThen(publish),
                Effect.andThen(wrote([safe])),
              ),
            )
      },
    }

    yield* refresh
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const asset of known.values()) {
          URL.revokeObjectURL(asset.url)
        }
      }),
    )

    return files
  })
