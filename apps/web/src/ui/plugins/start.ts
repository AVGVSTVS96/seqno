import { Effect, Stream } from "effect"
import { AsyncResult, type AtomRegistry } from "effect/reactivity"
import { CoreClient } from "@seqno/rpc"
import {
  changedPayload,
  installedPlugins,
  routePayload,
  startPlugins,
  type Host,
} from "@seqno/plugins"
import { openGraph, resolvedTheme } from "../../atoms.ts"
import type { router as appRouter } from "../../router.tsx"
import { makeBridge } from "./bridge.ts"

const themeClasses = (mode: "light" | "dark") => {
  document.documentElement.classList.toggle("dark", mode === "dark")
  document.body.classList.toggle("dark-theme", mode === "dark")
  document.body.classList.toggle("white-theme", mode === "light")
  document.body.classList.toggle("light-theme", mode === "light")
}

export const startPluginHost = (registry: AtomRegistry.AtomRegistry, router: typeof appRouter) => {
  registry.subscribe(resolvedTheme, themeClasses, { immediate: true })
  const started: { host: Host | null } = { host: null }

  const start = () => {
    registry.subscribe(
      installedPlugins,
      (installed) => {
        if (installed.length > 0) void import("@tabler/icons-webfont/dist/tabler-icons.min.css")
      },
      { immediate: true },
    )
    const bridge = makeBridge(registry, router)
    const host = startPlugins(registry, bridge)
    router.subscribe("onResolved", () =>
      host.hook("app", "route_changed", routePayload(bridge.route())),
    )
    registry.subscribe(resolvedTheme, (mode) => host.hook("app", "theme_mode_changed", { mode }))
    void bridge
      .run(
        Effect.flatMap(CoreClient, (core) =>
          Stream.runForEach(core.WatchChanges(), (events) =>
            Effect.sync(() => host.hook("db", "changed", changedPayload(events))),
          ),
        ),
      )
      .catch(() => undefined)
    return host
  }

  registry.subscribe(
    openGraph,
    (result) => {
      if (!AsyncResult.isSuccess(result)) return
      if (started.host === null) started.host = start()
      else started.host.hook("app", "current_graph_changed", {})
    },
    { immediate: true },
  )
}
