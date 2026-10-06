import themeCss from "./theme.css?inline"
import interCss from "@fontsource-variable/inter/index.css?inline"
import interItalicCss from "@fontsource-variable/inter/wght-italic.css?inline"
import appCss from "./styles.css?inline"
import { RegistryContext, scheduleTask } from "@effect/atom-react"
import { RouterProvider } from "@tanstack/react-router"
import { Layer } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { coreRuntime } from "@seqno/outliner"
import { prefersDark, theme } from "./atoms.ts"
import { WorkerCore } from "./core.ts"
import { router } from "./router.tsx"

const registry = AtomRegistry.make({
  scheduleTask,
  defaultIdleTTL: 400,
  initialValues: [[coreRuntime.layer, Layer.orDie(WorkerCore)]],
})

const darkScheme = matchMedia("(prefers-color-scheme: dark)")
registry.set(prefersDark, darkScheme.matches)
darkScheme.addEventListener("change", (event) => registry.set(prefersDark, event.matches))

registry.subscribe(
  theme,
  (choice) => {
    document.documentElement.dataset["theme"] = choice
  },
  { immediate: true },
)

const container = document.getElementById("root")

if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <style href="seqno/theme" precedence="theme">
        {themeCss}
      </style>
      <style href="seqno/inter" precedence="theme">
        {interCss}
      </style>
      <style href="seqno/inter-italic" precedence="theme">
        {interItalicCss}
      </style>
      <style href="seqno/app" precedence="app">
        {appCss}
      </style>
      <RegistryContext.Provider value={registry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>
    </StrictMode>,
  )
}
