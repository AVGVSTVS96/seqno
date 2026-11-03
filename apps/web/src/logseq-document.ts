import type { AtomRegistry } from "effect/reactivity"
import { attributesOf, logseqDocument, type DocumentState, type LogseqNames } from "@seqno/dom"
import { resolvedTheme } from "./atoms.ts"
import { accentColor } from "./ui/shell/state.ts"
import type { router as appRouter } from "./router.tsx"

const platform = (): DocumentState["platform"] => {
  const name = navigator.platform
  return /Mac|iPhone|iPad/.test(name) ? "mac" : /Win/.test(name) ? "win32" : "linux"
}

const marker = (element: HTMLElement) => {
  let shown: ReadonlyArray<string> = []
  return (made: LogseqNames) => {
    element.classList.remove(...shown)
    shown = made.className.split(" ").filter((name) => name !== "")
    element.classList.add(...shown)
    for (const [name, value] of Object.entries(attributesOf(made)))
      if (name !== "class") element.setAttribute(name, value)
  }
}

export const markLogseqDocument = (
  registry: AtomRegistry.AtomRegistry,
  router: typeof appRouter,
) => {
  const html = marker(document.documentElement)
  const body = marker(document.body)
  const mark = () => {
    const names = logseqDocument({
      mode: registry.get(resolvedTheme),
      route: router.state.matches.at(-1)?.routeId,
      platform: platform(),
      color: registry.get(accentColor),
    })
    html(names.html)
    body(names.body)
  }
  registry.subscribe(resolvedTheme, mark, { immediate: true })
  registry.subscribe(accentColor, mark)
  router.subscribe("onResolved", mark)
}
