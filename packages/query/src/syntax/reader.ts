import { Match } from "effect"
import { fail } from "../error.ts"

type Coll = "List" | "Vec" | "Map" | "Set"
type Atom = "Str" | "Kw" | "Sym" | "Wiki"

export type Form =
  | { readonly [K in Coll]: { readonly _tag: K; readonly items: ReadonlyArray<Form> } }[Coll]
  | { readonly [K in Atom]: { readonly _tag: K; readonly v: string } }[Atom]
  | { readonly _tag: "Num"; readonly v: number }

export type Of<T extends Form["_tag"]> = Extract<Form, { readonly _tag: T }>

const DELIM = /[\s,()[\]{}";]/
const NUMBER = /^[+-]?\d+(\.\d+)?$/

const OPENERS: ReadonlyArray<
  readonly [open: string, close: string, make: (items: Form[]) => Form]
> = [
  ["#{", "}", (items) => ({ _tag: "Set", items })],
  ["(", ")", (items) => ({ _tag: "List", items })],
  ["[", "]", (items) => ({ _tag: "Vec", items })],
  ["{", "}", (items) => ({ _tag: "Map", items })],
]

export const read = (src: string, options: { readonly wiki: boolean }): Form[] => {
  let i = 0
  const skip = () => {
    while (i < src.length) {
      if (/[\s,]/.test(src.charAt(i))) i++
      else if (src[i] === ";") while (i < src.length && src[i] !== "\n") i++
      else break
    }
  }
  const atom = (): string => {
    const start = i
    while (i < src.length && !DELIM.test(src.charAt(i))) i++
    return src.slice(start, i)
  }
  const form = (): Form => {
    skip()
    if (i >= src.length) return fail("unexpected end of query")
    const c = src.charAt(i)
    if (options.wiki && (src.startsWith("[[", i) || src.startsWith("#[[", i))) {
      const start = src.indexOf("[[", i) + 2
      const end = src.indexOf("]]", start)
      if (end < 0) return fail("unclosed [[")
      i = end + 2
      return { _tag: "Wiki", v: src.slice(start, end) }
    }
    const opener = OPENERS.find(([open]) => src.startsWith(open, i))
    if (opener !== undefined) {
      const [open, close, make] = opener
      i += open.length
      const items: Form[] = []
      for (skip(); src[i] !== close; skip()) {
        if (i >= src.length) return fail(`missing ${close}`)
        items.push(form())
      }
      i++
      return make(items)
    }
    if (c === ")" || c === "]" || c === "}") return fail(`unexpected ${c}`)
    if (c === '"') {
      let out = ""
      for (i++; src[i] !== '"'; i++) {
        if (i >= src.length) return fail("unclosed string")
        if (src[i] === "\\") i++
        out += src.charAt(i)
      }
      i++
      return { _tag: "Str", v: out }
    }
    if (c === ":") {
      i++
      return { _tag: "Kw", v: atom() }
    }
    const text = atom()
    return NUMBER.test(text) ? { _tag: "Num", v: Number(text) } : { _tag: "Sym", v: text }
  }
  const out: Form[] = []
  for (skip(); i < src.length; skip()) out.push(form())
  return out
}

const joined = (items: ReadonlyArray<Form>) => items.map(show).join(" ")

export const show = (f: Form): string =>
  Match.valueTags(f, {
    List: (x) => `(${joined(x.items)})`,
    Vec: (x) => `[${joined(x.items)}]`,
    Map: (x) => `{${joined(x.items)}}`,
    Set: (x) => `#{${joined(x.items)}}`,
    Str: (x) => JSON.stringify(x.v),
    Kw: (x) => `:${x.v}`,
    Wiki: (x) => `[[${x.v}]]`,
    Num: (x) => String(x.v),
    Sym: (x) => x.v,
  })

export const isColl = (f: Form | undefined): f is Of<Coll> =>
  f !== undefined && (f._tag === "List" || f._tag === "Vec" || f._tag === "Map" || f._tag === "Set")
