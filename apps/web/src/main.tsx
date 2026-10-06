import { RegistryProvider } from "@effect/atom-react"
import { RouterProvider } from "@tanstack/react-router"
import { Layer } from "effect"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { coreRuntime } from "@seqno/outliner"
import { WorkerCore } from "./core.ts"
import { router } from "./router.tsx"

const container = document.getElementById("root")

if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <RegistryProvider initialValues={[[coreRuntime.layer, Layer.orDie(WorkerCore)]]}>
        <RouterProvider router={router} />
      </RegistryProvider>
    </StrictMode>,
  )
}
