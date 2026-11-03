import type { AtomRegistry } from "effect/reactivity"
import { resolvedTheme } from "./atoms.ts"
import type { router as appRouter } from "./router.tsx"

const pageNames: Readonly<Record<string, string>> = {
  "/": "home",
  "/page/$name": "page",
  "/all-pages": "all-pages",
  "/graph": "graph",
  "/whiteboards": "whiteboards",
  "/graphs": "repos",
  "/search": "home",
}

const platform = () => {
  const name = navigator.platform
  return /Mac|iPhone|iPad/.test(name) ? "is-mac" : /Win/.test(name) ? "is-win32" : "is-linux"
}

const markTheme = (mode: "light" | "dark") => {
  const root = document.documentElement
  root.dataset["theme"] = mode
  root.classList.toggle("dark", mode === "dark")
  document.body.classList.toggle("dark-theme", mode === "dark")
  document.body.classList.toggle("white-theme", mode === "light")
  document.body.classList.toggle("light-theme", mode === "light")
}

const markPage = (router: typeof appRouter) => {
  const routeId = router.state.matches.at(-1)?.routeId
  document.body.dataset["page"] = routeId === undefined ? "home" : (pageNames[routeId] ?? "home")
}

export const markLogseqDocument = (
  registry: AtomRegistry.AtomRegistry,
  router: typeof appRouter,
) => {
  document.documentElement.dataset["color"] = "logseq"
  document.documentElement.classList.add(platform())
  registry.subscribe(resolvedTheme, markTheme, { immediate: true })
  markPage(router)
  router.subscribe("onResolved", () => markPage(router))
}
