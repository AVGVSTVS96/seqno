import { createRoot, hydrateRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { commits } from "./commits.ts"
import "./styles.css"

const root = document.querySelector("#root")

if (root?.hasChildNodes() === true) {
  hydrateRoot(root, <App />)
} else if (root) {
  createRoot(root).render(<App />)
}

void commits.refresh()
