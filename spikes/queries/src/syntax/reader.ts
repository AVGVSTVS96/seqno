import { fail } from "../literal.ts"

export type Form =
  | { readonly t: "list" | "vec" | "map" | "set"; readonly items: ReadonlyArray<Form> }
  | { readonly t: "str" | "kw" | "sym" | "wiki"; readonly v: string }
  | { readonly t: "num"; readonly v: number }

const DELIM = /[\s,()[\]{}";]/
const CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}", "#{": "}" }
const KIND = { "(": "list", "[": "vec", "{": "map", "#{": "set" } as const

export const read = (src: string, options: { readonly wiki: boolean }): Form[] => {
  let i = 0
  const skip = () => {
    while (i < src.length) {
      if (/[\s,]/.test(src[i]!)) i++
      else if (src[i] === ";") while (i < src.length && src[i] !== "\n") i++
      else break
    }
  }
  const atom = (): string => {
    const start = i
    while (i < src.length && !DELIM.test(src[i]!)) i++
    return src.slice(start, i)
  }
  const form = (): Form => {
    skip()
    if (i >= src.length) return fail("unexpected end of query")
    const c = src[i]!
    if (options.wiki && (src.startsWith("[[", i) || src.startsWith("#[[", i))) {
      const start = src.indexOf("[[", i) + 2
      const end = src.indexOf("]]", start)
      if (end < 0) return fail("unclosed [[")
      i = end + 2
      return { t: "wiki", v: src.slice(start, end) }
    }
    const open = src.startsWith("#{", i) ? "#{" : c in CLOSE ? c : null
    if (open !== null) {
      i += open.length
      const items: Form[] = []
      for (skip(); src[i] !== CLOSE[open]; skip()) {
        if (i >= src.length) return fail(`missing ${CLOSE[open]}`)
        items.push(form())
      }
      i++
      return { t: KIND[open as keyof typeof KIND], items }
    }
    if (c === ")" || c === "]" || c === "}") return fail(`unexpected ${c}`)
    if (c === '"') {
      let out = ""
      for (i++; src[i] !== '"'; i++) {
        if (i >= src.length) return fail("unclosed string")
        out += src[i] === "\\" ? src[++i] : src[i]
      }
      i++
      return { t: "str", v: out }
    }
    if (c === ":") {
      i++
      return { t: "kw", v: atom() }
    }
    const text = atom()
    return /^[+-]?\d+(\.\d+)?$/.test(text) ? { t: "num", v: Number(text) } : { t: "sym", v: text }
  }
  const out: Form[] = []
  for (skip(); i < src.length; skip()) out.push(form())
  return out
}

export const show = (f: Form): string => {
  switch (f.t) {
    case "list":
      return `(${f.items.map(show).join(" ")})`
    case "vec":
      return `[${f.items.map(show).join(" ")}]`
    case "map":
      return `{${f.items.map(show).join(" ")}}`
    case "set":
      return `#{${f.items.map(show).join(" ")}}`
    case "str":
      return JSON.stringify(f.v)
    case "kw":
      return `:${f.v}`
    case "wiki":
      return `[[${f.v}]]`
    case "num":
      return String(f.v)
    case "sym":
      return f.v
  }
}
