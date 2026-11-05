import { Effect } from "effect"
import { CoreClient } from "@seqno/rpc"
import { appRuntime } from "../../atoms.ts"
import { notify } from "./Notices.tsx"

export const rebuildIndex = appRuntime.fn((_, get) =>
  Effect.flatMap(Effect.service(CoreClient), (core) => core.RebuildIndex()).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        notify(get.registry, "Search indices rebuilt successfully!")
      }),
    ),
  ),
)
