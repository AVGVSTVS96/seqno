import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Stream } from "effect"
import { makeSaveLog } from "../saving.ts"

describe("the save log", () => {
  it.effect("tells each tab how far its requests are written", () =>
    Effect.gen(function* () {
      const log = yield* makeSaveLog

      const shown = (client: number) =>
        Effect.map(Stream.runHead(log.watch(client)), Option.getOrNull)

      yield* log.edited
      yield* log.handled(1, 1)
      const at = yield* log.started
      yield* log.edited
      yield* log.handled(1, 2)
      yield* log.saved(at)
      const midway = yield* shown(1)
      yield* log.saved(yield* log.started)
      const written = yield* shown(1)
      yield* log.handled(1, 3)
      assert.deepStrictEqual(
        { midway, written, nothingNew: yield* shown(1), otherTab: yield* shown(2) },
        {
          midway: { _tag: "Unsaved" },
          written: { _tag: "Saved", through: 2 },
          nothingNew: { _tag: "Saved", through: 3 },
          otherTab: { _tag: "Saved" },
        },
      )
    }),
  )
})
