import reactDomUrl from "react-dom-17/umd/react-dom.production.min.js?url"
import reactUrl from "react-17/umd/react.production.min.js?url"
import type { AtomRegistry } from "effect/reactivity"
import { addKatexEnhancer, dropKatexEnhancers, katexEnhancers, redrawMath } from "@seqno/outliner"
import type { Host } from "./host.ts"
import { record, text } from "./package.ts"
import { fencedRenderers } from "./state.ts"

declare global {
  interface Window {
    React?: unknown
    ReactDOM?: unknown
    logseq?: unknown
  }
}

export interface LegacyReact {
  readonly createElement: (type: unknown, props: unknown) => unknown
}

export interface LegacyReactDom {
  readonly render: (element: unknown, node: Element) => unknown
  readonly unmountComponentAtNode: (node: Element) => boolean
}

const isReact = (value: unknown): value is LegacyReact =>
  typeof value === "object" &&
  value !== null &&
  "createElement" in value &&
  typeof value.createElement === "function"

const isReactDom = (value: unknown): value is LegacyReactDom =>
  typeof value === "object" &&
  value !== null &&
  "render" in value &&
  "unmountComponentAtNode" in value &&
  typeof value.render === "function" &&
  typeof value.unmountComponentAtNode === "function"

export const legacyReact = (): {
  readonly React: LegacyReact
  readonly ReactDOM: LegacyReactDom
} | null => {
  const { React, ReactDOM } = window
  return isReact(React) && isReactDom(ReactDOM) ? { React, ReactDOM } : null
}

const scripts = new Map<
  string,
  { readonly script: HTMLScriptElement; readonly loaded: Promise<void> }
>()

const loadScript = (src: string, ref: string | null) => {
  const known = scripts.get(src)
  if (known?.script.isConnected === true) return known.loaded
  const script = document.createElement("script")
  script.src = src
  if (ref !== null) script.dataset["ref"] = ref
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true })
    script.addEventListener("error", () => reject(new Error(`${src} didn't load`)), { once: true })
  })
  document.head.append(script)
  scripts.set(src, { script, loaded })
  return loaded
}

const experimentsFor = (registry: AtomRegistry.AtomRegistry, host: Host) => {
  const known = (pid: unknown) => {
    const id = text(pid)
    return id !== null && host.loaded(id) ? id : null
  }
  const enhancesKatex = (pid: string) => registry.get(katexEnhancers).some((one) => one.pid === pid)
  return {
    load_scripts: async (pid: unknown, ...sources: ReadonlyArray<unknown>) => {
      const ref = known(pid)
      if (ref === null) return
      for (const source of sources) {
        const src = text(source)
        if (src !== null) await loadScript(src, ref)
      }
      if (enhancesKatex(ref)) redrawMath(registry)
    },
    register_fenced_code_renderer: (pid: unknown, type: unknown, opts: unknown) => {
      const ref = known(pid)
      const lang = text(type)
      const options = record(opts)
      if (ref === null || lang === null || typeof options["render"] !== "function") return
      const renderer = {
        pid: ref,
        type: lang,
        edit: options["edit"] !== false,
        render: options["render"],
      }
      registry.set(fencedRenderers, [
        ...registry.get(fencedRenderers).filter((one) => one.pid !== ref || one.type !== lang),
        renderer,
      ])
      return () =>
        registry.set(
          fencedRenderers,
          registry.get(fencedRenderers).filter((one) => one !== renderer),
        )
    },
    register_extensions_enhancer: (pid: unknown, type: unknown, enhance: unknown) => {
      const ref = known(pid)
      if (ref === null || text(type) !== "katex" || typeof enhance !== "function") return
      addKatexEnhancer(registry, { pid: ref, enhance: (katex) => enhance(katex) })
      return () => void dropKatexEnhancers(registry, ref)
    },
  }
}

let opened: Promise<void> | null = null

export const openHostScope = (registry: AtomRegistry.AtomRegistry, host: Host) => {
  opened ??= (async () => {
    await loadScript(reactUrl, null)
    await loadScript(reactDomUrl, null)
    const experiments = experimentsFor(registry, host)
    window.logseq = {
      api: Object.fromEntries(
        Object.entries(experiments).map(([name, method]) => [`exper_${name}`, method]),
      ),
      sdk: { experiments, utils: {} },
    }
  })()
  return opened
}
