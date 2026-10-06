import { RegistryProvider } from "@effect/atom-react"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { router } from "./router.tsx"

const container = document.getElementById("root")

if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <RegistryProvider>
        <RouterProvider router={router} />
      </RegistryProvider>
    </StrictMode>,
  )
}
