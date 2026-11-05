import reactDomUrl from "react-dom-17/umd/react-dom.production.min.js?url"
import reactUrl from "react-17/umd/react.production.min.js?url"
import type { AtomRegistry } from "effect/reactivity"
import { addKatexEnhancer, dropKatexEnhancers, katexEnhancers, redrawMath } from "@seqno/outliner"
import type { Host } from "./host.ts"
import { record, text } from "./package.ts"
import { fencedRenderers } from "./state.ts"
import type { LegacyComponent, LegacyElement, LegacyProps } from "./state.ts"
import type { KatexEnhancer } from "@seqno/outliner"

declare global {
  interface Window {
    React?: unknown
    ReactDOM?: unknown
    logseq?: unknown
  }
}

export interface LegacyReact {
  readonly createElement: (type: LegacyComponent, props: LegacyProps) => LegacyElement
}

export interface LegacyReactDom {
  readonly render: (element: LegacyElement, node: Element) => void
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

const isComponent = (value: unknown): value is LegacyComponent => typeof value === "function"

const isEnhancer = (value: unknown): value is KatexEnhancer["enhance"] =>
  typeof value === "function"

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

const loadScript = async (src: string, ref: string | null) => {
  const known = scripts.get(src)

  if (known?.script.isConnected === true) {
    await known.loaded

    return
  }

  const script = document.createElement("script")
  script.src = src

  if (ref !== null) {
    script.dataset["ref"] = ref
  }

  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener(
      "load",
      () => {
        resolve()
      },
      { once: true },
    )
    script.addEventListener(
      "error",
      () => {
        reject(new Error(`${src} didn't load`))
      },
      { once: true },
    )
  })

  document.head.append(script)
  scripts.set(src, { script, loaded })

  await loaded
}

const experimentsFor = (registry: AtomRegistry.AtomRegistry, host: Host) => {
  const known = (id: string | null) => (id !== null && host.loaded(id) ? id : null)

  const enhancesKatex = (pid: string) => registry.get(katexEnhancers).some((one) => one.pid === pid)

  return {
    load_scripts: async (...[pid, ...sources]: readonly unknown[]) => {
      const ref = known(text(pid))

      if (ref === null) {
        return
      }

      for (const source of sources) {
        const src = text(source)

        if (src !== null) {
          await loadScript(src, ref)
        }
      }

      if (enhancesKatex(ref)) {
        redrawMath(registry)
      }
    },
    register_fenced_code_renderer: (...[pid, type, opts]: readonly unknown[]) => {
      const ref = known(text(pid))
      const lang = text(type)
      const options = record(opts)
      const render = options["render"]

      if (ref === null || lang === null || !isComponent(render)) {
        return
      }

      const renderer = { pid: ref, type: lang, edit: options["edit"] !== false, render }

      registry.set(fencedRenderers, [
        ...registry.get(fencedRenderers).filter((one) => one.pid !== ref || one.type !== lang),
        renderer,
      ])

      return () => {
        registry.set(
          fencedRenderers,
          registry.get(fencedRenderers).filter((one) => one !== renderer),
        )
      }
    },
    register_extensions_enhancer: (...[pid, type, enhance]: readonly unknown[]) => {
      const ref = known(text(pid))

      if (ref === null || text(type) !== "katex" || !isEnhancer(enhance)) {
        return
      }

      addKatexEnhancer(registry, { pid: ref, enhance })

      return () => void dropKatexEnhancers(registry, ref)
    },
  }
}

let opened: Promise<void> | null = null

export const openHostScope = async (registry: AtomRegistry.AtomRegistry, host: Host) => {
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

  await opened
}
