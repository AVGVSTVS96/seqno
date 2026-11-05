import { Effect, Semaphore, Stream, SubscriptionRef } from "effect"
import { AppFilePath } from "@seqno/rpc"
import type { AppFile } from "@seqno/rpc"
import type { Storage, StorageFailed } from "@seqno/vault"

export interface AppFiles {
  readonly listed: SubscriptionRef.SubscriptionRef<readonly AppFile[]>
  readonly write: (file: AppFile) => Effect.Effect<void, StorageFailed>
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

const appFolder = "logseq/"

const same = (left: readonly AppFile[], right: readonly AppFile[]) =>
  left.length === right.length &&
  left.every((file, at) => file.path === right[at]?.path && file.text === right[at]?.text)

export const makeAppFiles = (
  storage: Storage["Service"],
  changed: Stream.Stream<readonly string[]>,
  wrote: (paths: readonly string[]) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const read = Effect.map(
      Effect.forEach(AppFilePath.literals, (path) =>
        storage.read(path).pipe(
          Effect.map((bytes): readonly AppFile[] => [{ path, text: decoder.decode(bytes) }]),
          Effect.orElseSucceed((): readonly AppFile[] => []),
        ),
      ),
      (found) => found.flat(),
    )

    const listed = yield* SubscriptionRef.make<readonly AppFile[]>(yield* read)
    const lock = yield* Semaphore.make(1)

    const refresh = lock.withPermit(
      Effect.flatMap(read, (files) =>
        Effect.flatMap(SubscriptionRef.get(listed), (shown) =>
          same(shown, files) ? Effect.void : SubscriptionRef.set(listed, files),
        ),
      ),
    )

    yield* Effect.forkScoped(
      changed.pipe(
        Stream.filter((paths) => paths.some((path) => path === "" || path.startsWith(appFolder))),
        Stream.runForEach(() => refresh),
      ),
    )

    const files: AppFiles = {
      listed,
      write: ({ path, text }) =>
        storage
          .write(path, encoder.encode(text))
          .pipe(Effect.andThen(refresh), Effect.andThen(wrote([path]))),
    }

    return files
  })
