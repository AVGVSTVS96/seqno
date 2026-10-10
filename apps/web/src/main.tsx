import appCss from "./styles.css?inline"
import { RegistryContext, scheduleTask } from "@effect/atom-react"
import { RouterProvider } from "@tanstack/react-router"
import { Layer } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { coreLayer } from "@seqno/outliner"
import { lastGraph, openGraph, prefersDark, resolvedTheme, startingGraph } from "./atoms.ts"
import { WorkerCore } from "./core.ts"
import { router } from "./router.tsx"

const registry = AtomRegistry.make({
  scheduleTask,
  defaultIdleTTL: 400,
  initialValues: [[coreLayer, Layer.orDie(WorkerCore)]],
})

const darkScheme = matchMedia("(prefers-color-scheme: dark)")
registry.set(prefersDark, darkScheme.matches)
darkScheme.addEventListener("change", (event) => registry.set(prefersDark, event.matches))

registry.subscribe(
  resolvedTheme,
  (resolved) => {
    document.documentElement.dataset["theme"] = resolved
  },
  { immediate: true },
)

const starting = startingGraph(registry.get(lastGraph))
if (starting !== null) registry.set(openGraph, starting)

await Promise.allSettled([
  document.fonts.load('16px "Inter Variable"'),
  document.fonts.load('italic 16px "Inter Variable"'),
])

const container = document.getElementById("root")

if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <style href="seqno/app" precedence="app">
        {appCss}
      </style>
      <RegistryContext.Provider value={registry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>
    </StrictMode>,
  )
}
