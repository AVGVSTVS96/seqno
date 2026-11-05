import { useCallback } from "react"
import { useAtomValue } from "@effect/atom-react"
import { Effect } from "effect"
import { AsyncResult, Atom } from "effect/reactivity"
import type { AtomRegistry } from "effect/reactivity"
import type { KatexOptions } from "katex"
import { logseq } from "@seqno/dom"

declare global {
  interface Window {
    katex?: unknown
  }
}

interface Katex {
  readonly render: (tex: string, element: HTMLElement, options: KatexOptions) => void
}

export interface KatexEnhancer {
  readonly pid: string
  readonly enhance: (katex: unknown) => unknown
}

export const katexEnhancers = Atom.make<readonly KatexEnhancer[]>([]).pipe(Atom.keepAlive)

export const mathRedraws = Atom.make(0).pipe(Atom.keepAlive)

const isKatex = (value: unknown): value is Katex =>
  typeof value === "object" &&
  value !== null &&
  "render" in value &&
  typeof value.render === "function"

let pristine: { readonly katex: object; readonly own: Readonly<Record<string, unknown>> } | null =
  null

const enhanceAll = async (enhancers: readonly KatexEnhancer[], katex: object) =>
  await Promise.allSettled(enhancers.map(async ({ enhance }) => enhance(window.katex ?? katex)))

const enhancedKatex = async (enhancers: readonly KatexEnhancer[]) => {
  const { katex, css } = await (await import("./katex.ts")).loadKatex()
  pristine = { katex, own: { ...katex } }
  await enhanceAll(enhancers, katex)

  return { katex, css }
}

export const redrawMath = (registry: AtomRegistry.AtomRegistry) => {
  registry.set(mathRedraws, registry.get(mathRedraws) + 1)
}

export const addKatexEnhancer = (registry: AtomRegistry.AtomRegistry, enhancer: KatexEnhancer) => {
  registry.set(katexEnhancers, [...registry.get(katexEnhancers), enhancer])
  redrawMath(registry)
}

export const dropKatexEnhancers = async (registry: AtomRegistry.AtomRegistry, pid: string) => {
  const all = registry.get(katexEnhancers)
  const rest = all.filter((one) => one.pid !== pid)

  if (rest.length === all.length) {
    return
  }

  registry.set(katexEnhancers, rest)

  if (pristine === null) {
    return
  }

  Object.assign(pristine.katex, pristine.own)
  await enhanceAll(rest, pristine.katex)
  redrawMath(registry)
}

const katexAtom = Atom.make((get) =>
  Effect.promise(async () => await enhancedKatex(get.once(katexEnhancers))),
).pipe(Atom.keepAlive)

const draw = (fallback: Katex, element: HTMLElement, tex: string, display: boolean) => {
  const source = document.createElement("span")
  source.className = logseq("seqno-latex-source").className
  source.textContent = tex
  element.replaceChildren(source)
  const live = isKatex(window.katex) ? window.katex : fallback

  try {
    live.render(tex, element, { displayMode: display, throwOnError: false, strict: false })
  } catch (error) {
    console.error(error)
  }
}

export const Latex = ({
  tex,
  block,
  caret,
}: {
  readonly tex: string
  readonly block: boolean
  readonly caret: number
}) => {
  const loaded = useAtomValue(katexAtom)
  const redraws = useAtomValue(mathRedraws)
  const value = AsyncResult.getOrElse(loaded, () => null)

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (element !== null && value !== null) {
        draw(value.katex, element, tex, block)
      }
    },
    [value, tex, block],
  )

  const key = value === null ? "wait" : `drawn ${redraws}`
  const part = block ? "seqno-latex" : "seqno-latex-inline"
  const placeholder = value === null ? <span {...logseq("seqno-latex-source")}>{tex}</span> : null

  return (
    <>
      {value === null ? null : (
        <style href="katex" precedence="default">
          {value.css}
        </style>
      )}
      {block ? (
        <div key={key} {...logseq(part)} data-caret={caret} ref={ref}>
          {placeholder}
        </div>
      ) : (
        <span key={key} {...logseq(part)} data-caret={caret} ref={ref}>
          {placeholder}
        </span>
      )}
    </>
  )
}
