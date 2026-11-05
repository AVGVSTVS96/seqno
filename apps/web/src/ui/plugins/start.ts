import { Effect, Stream } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { AtomRegistry } from "effect/reactivity"
import { CoreClient } from "@seqno/rpc"
import type { Change } from "@seqno/rpc"
import {
  changedPayload,
  installedPlugins,
  routePayload,
  startPlugins,
  watchUpdates,
} from "@seqno/plugins"
import type { Host } from "@seqno/plugins"
import { openGraph, resolvedTheme } from "../../atoms.ts"
import type { router as appRouter } from "../../router.tsx"
import { appBridge } from "./bridge.ts"

const leadFor = () => {
  const lead = { graph: "", now: false, stop: new AbortController() }

  return {
    follow: (graph: string) => {
      if (graph === lead.graph) {
        return
      }

      lead.stop.abort()
      const stop = new AbortController()
      Object.assign(lead, { graph, now: false, stop })
      void navigator.locks
        .request(`seqno.plugins.${graph}`, { signal: stop.signal }, async () => {
          lead.now = true

          await new Promise<void>((resolve) => {
            stop.signal.addEventListener("abort", () => {
              resolve()
            })
          })
        })
        .catch(() => {})
    },
    acts: ({ madeIn }: Change) => madeIn === "thisTab" || (madeIn === "noTab" && lead.now),
  }
}

export const startPluginHost = (registry: AtomRegistry.AtomRegistry, router: typeof appRouter) => {
  let started: Host | null = null
  const lead = leadFor()

  const start = () => {
    registry.subscribe(
      installedPlugins,
      (installed) => {
        if (installed.length > 0) {
          void import("@tabler/icons-webfont/dist/tabler-icons.min.css")
        }
      },
      { immediate: true },
    )
    const bridge = appBridge(registry, router)
    const host = startPlugins(registry, bridge)
    watchUpdates(registry)
    router.subscribe("onResolved", () => {
      host.hook("app", "route_changed", routePayload(bridge.route()))
    })
    registry.subscribe(resolvedTheme, (mode) => {
      host.hook("app", "theme_mode_changed", { mode })
    })
    void bridge
      .run(
        Effect.flatMap(CoreClient, (core) =>
          Stream.runForEach(core.WatchChanges(), (change) =>
            Effect.sync(() => {
              if (lead.acts(change)) {
                host.hook("db", "changed", changedPayload(change.events))
              }
            }),
          ),
        ),
      )
      .catch(() => {})

    return host
  }

  registry.subscribe(
    openGraph,
    (result) => {
      if (!AsyncResult.isSuccess(result)) {
        return
      }

      lead.follow(result.value.graph)

      if (started === null) {
        started = start()
      } else {
        started.hook("app", "current_graph_changed", {})
      }
    },
    { immediate: true },
  )
}
