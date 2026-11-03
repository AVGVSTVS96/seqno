import { Result } from "effect"

export type Edn =
  | string
  | number
  | boolean
  | null
  | { readonly _tag: "Keyword"; readonly name: string }
  | { readonly _tag: "Symbol"; readonly name: string }
  | { readonly _tag: "Tagged"; readonly tag: string; readonly value: Edn }
  | { readonly _tag: "Vector"; readonly items: ReadonlyArray<Edn> }
  | { readonly _tag: "List"; readonly items: ReadonlyArray<Edn> }
  | { readonly _tag: "Set"; readonly items: ReadonlyArray<Edn> }
  | { readonly _tag: "Map"; readonly entries: ReadonlyArray<readonly [Edn, Edn]> }

export const keyword = (name: string): Edn => ({ _tag: "Keyword", name })
export const uuid = (value: string): Edn => ({ _tag: "Tagged", tag: "uuid", value })
export const vector = (items: ReadonlyArray<Edn>): Edn => ({ _tag: "Vector", items })
export const list = (items: ReadonlyArray<Edn>): Edn => ({ _tag: "List", items })
export const map = (entries: ReadonlyArray<readonly [string, Edn]>): Edn => ({
  _tag: "Map",
  entries: entries.map(([key, value]) => [keyword(key), value]),
})

const SPACE = /[\s,]/
const DELIMITER = /[\s,()[\]{}"\\;]/
const NUMBER = /^[+-]?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?M?$|^[+-]?\d+N$/
const ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
}

class Reader {
  at = 0
  failure: string | null = null
  readonly text: string
  constructor(text: string) {
    this.text = text
  }

  fail(reason: string): Edn {
    this.failure ??= `${reason} at ${this.at}`
    return null
  }

  skip() {
    while (this.at < this.text.length) {
      const char = this.text[this.at] ?? ""
      if (SPACE.test(char)) this.at += 1
      else if (char === ";") {
        const end = this.text.indexOf("\n", this.at)
        this.at = end === -1 ? this.text.length : end
      } else if (this.text.startsWith("#_", this.at)) {
        this.at += 2
        this.value()
      } else return
    }
  }

  items(close: string): ReadonlyArray<Edn> {
    const items: Array<Edn> = []
    for (;;) {
      this.skip()
      if (this.failure !== null) return items
      if (this.at >= this.text.length) {
        this.fail(`missing ${close}`)
        return items
      }
      if (this.text[this.at] === close) {
        this.at += 1
        return items
      }
      items.push(this.value())
    }
  }

  string(): Edn {
    let out = ""
    this.at += 1
    while (this.at < this.text.length) {
      const char = this.text[this.at] ?? ""
      if (char === '"') {
        this.at += 1
        return out
      }
      if (char === "\\") {
        const next = this.text[this.at + 1] ?? ""
        if (next === "u") {
          out += String.fromCharCode(Number.parseInt(this.text.slice(this.at + 2, this.at + 6), 16))
          this.at += 6
        } else {
          out += ESCAPES[next] ?? next
          this.at += 2
        }
      } else {
        out += char
        this.at += 1
      }
    }
    return this.fail("unterminated string")
  }

  token(): string {
    const start = this.at
    while (this.at < this.text.length && !DELIMITER.test(this.text[this.at] ?? "")) this.at += 1
    return this.text.slice(start, this.at)
  }

  value(): Edn {
    this.skip()
    const char = this.text[this.at]
    if (char === undefined) return this.fail("unexpected end")
    if (char === '"') return this.string()
    if (char === "(") {
      this.at += 1
      return { _tag: "List", items: this.items(")") }
    }
    if (char === "[") {
      this.at += 1
      return { _tag: "Vector", items: this.items("]") }
    }
    if (char === "{") {
      this.at += 1
      const items = this.items("}")
      if (items.length % 2 === 1) return this.fail("odd map")
      const entries: Array<readonly [Edn, Edn]> = []
      for (let index = 0; index < items.length; index += 2) {
        entries.push([items[index] ?? null, items[index + 1] ?? null])
      }
      return { _tag: "Map", entries }
    }
    if (char === "#" && this.text[this.at + 1] === "{") {
      this.at += 2
      return { _tag: "Set", items: this.items("}") }
    }
    if (char === "#") {
      this.at += 1
      const tag = this.token()
      return { _tag: "Tagged", tag, value: this.value() }
    }
    if (char === "\\") {
      this.at += 1
      return this.token() || this.text[this.at++] || ""
    }
    const token = this.token()
    if (token === "") return this.fail(`unexpected ${char}`)
    if (token.startsWith(":")) return { _tag: "Keyword", name: token.slice(1) }
    if (token === "nil") return null
    if (token === "true") return true
    if (token === "false") return false
    if (NUMBER.test(token)) return Number(token.replace(/[MN]$/, ""))
    return { _tag: "Symbol", name: token }
  }
}

export const readEdn = (text: string): Result.Result<Edn, string> => {
  const reader = new Reader(text)
  const value = reader.value()
  reader.skip()
  if (reader.failure === null && reader.at < text.length) reader.fail("trailing text")
  return reader.failure === null ? Result.succeed(value) : Result.fail(reader.failure)
}

const imul = Math.imul
const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k))
const mixK1 = (k1: number) => imul(rotl(imul(k1 | 0, 0xcc9e2d51 | 0), 15), 0x1b873593)
const mixH1 = (h1: number, k1: number) => (imul(rotl((h1 | 0) ^ (k1 | 0), 13), 5) + 0xe6546b64) | 0
const fmix = (start: number, length: number) => {
  let h1 = (start | 0) ^ length
  h1 ^= h1 >>> 16
  h1 = imul(h1, 0x85ebca6b | 0)
  h1 ^= h1 >>> 13
  h1 = imul(h1, 0xc2b2ae35 | 0)
  return h1 ^ (h1 >>> 16)
}

export const murmurChars = (text: string): number => {
  let h1 = 0
  for (let index = 1; index < text.length; index += 2) {
    h1 = mixH1(h1, mixK1(text.charCodeAt(index - 1) | (text.charCodeAt(index) << 16)))
  }
  if (text.length % 2 === 1) h1 ^= mixK1(text.charCodeAt(text.length - 1))
  return fmix(h1, imul(2, text.length))
}

const murmurInt = (value: number) => (value === 0 ? 0 : fmix(mixH1(0, mixK1(value)), 4))

const javaHash = (text: string) => {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = imul(31, hash) + text.charCodeAt(index)
  }
  return hash
}

const hashCombine = (seed: number, hash: number) =>
  seed ^ (hash + 0x9e3779b9 + (seed << 6) + (seed >> 2))

const keywordHash = (name: string) => {
  const parts = name.split("/")
  const [ns, local] = parts.length === 2 ? parts : [null, name]
  return (hashCombine(murmurChars(local ?? name), ns === null ? 0 : javaHash(ns)) + 0x9e3779b9) | 0
}

const keyHash = (key: Edn): number | null => {
  if (typeof key === "string") return murmurInt(javaHash(key))
  if (key !== null && typeof key === "object" && key._tag === "Keyword")
    return keywordHash(key.name)
  return null
}

const HASHMAP_THRESHOLD = 8

const levels = (hash: number) =>
  Array.from({ length: 7 }, (_, level) => (hash >>> (level * 5)) & 31)

export const hashOrder = (
  entries: ReadonlyArray<readonly [Edn, Edn]>,
  always = false,
): ReadonlyArray<readonly [Edn, Edn]> => {
  if (!always && entries.length <= HASHMAP_THRESHOLD) return entries
  const keyed = entries.map((entry) => ({ entry, hash: keyHash(entry[0]) }))
  if (keyed.some(({ hash }) => hash === null)) return entries
  return keyed
    .toSorted((a, b) => {
      const left = levels(a.hash ?? 0)
      const right = levels(b.hash ?? 0)
      const level = left.findIndex((chunk, index) => chunk !== right[index])
      return level === -1 ? 0 : (left[level] ?? 0) - (right[level] ?? 0)
    })
    .map(({ entry }) => entry)
}

const QUOTED = /["\\\b\f\n\r\t]/g
const QUOTES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
}

const quote = (text: string) => `"${text.replace(QUOTED, (char) => QUOTES[char] ?? char)}"`

export const printEdn = (value: Edn): string => {
  if (value === null) return "nil"
  if (typeof value === "string") return quote(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  switch (value._tag) {
    case "Keyword":
      return `:${value.name}`
    case "Symbol":
      return value.name
    case "Tagged":
      return `#${value.tag} ${printEdn(value.value)}`
    case "Vector":
      return `[${value.items.map(printEdn).join(" ")}]`
    case "List":
      return `(${value.items.map(printEdn).join(" ")})`
    case "Set":
      return `#{${value.items.map(printEdn).join(" ")}}`
    case "Map":
      return `\n{${hashOrder(value.entries)
        .map(([key, item]) => `${printEdn(key)} ${printEdn(item)}`)
        .join("\n")}}`
  }
}

export const mapEntries = (value: Edn): ReadonlyArray<readonly [Edn, Edn]> =>
  value !== null && typeof value === "object" && value._tag === "Map" ? value.entries : []

export const entriesOf = (value: Edn): ReadonlyMap<string, Edn> =>
  new Map(
    value !== null && typeof value === "object" && value._tag === "Map"
      ? value.entries.flatMap(([key, item]) => {
          const name = textOf(key)
          return name === null ? [] : [[name, item] as const]
        })
      : [],
  )

export const textOf = (value: Edn | undefined): string | null => {
  if (typeof value === "string") return value
  if (value === null || value === undefined || typeof value !== "object") return null
  if (value._tag === "Keyword" || value._tag === "Symbol") return value.name
  return value._tag === "Tagged" ? textOf(value.value) : null
}

export const itemsOf = (value: Edn | undefined): ReadonlyArray<Edn> =>
  value !== null &&
  value !== undefined &&
  typeof value === "object" &&
  (value._tag === "List" || value._tag === "Vector" || value._tag === "Set")
    ? value.items
    : []

export type Json = string | number | boolean | null | ReadonlyArray<Json> | JsonObject
export interface JsonObject {
  readonly [key: string]: Json
}

export const toJson = (value: Edn): Json => {
  if (value === null || typeof value !== "object") return value
  switch (value._tag) {
    case "Keyword":
    case "Symbol":
      return value.name
    case "Tagged":
      return toJson(value.value)
    case "Vector":
    case "List":
    case "Set":
      return value.items.map(toJson)
    case "Map":
      return Object.fromEntries(
        value.entries.map(([key, item]) => [textOf(key) ?? printEdn(key), toJson(item)]),
      )
  }
}

export const fromJson = (value: unknown): Edn => {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return vector(value.map(fromJson))
  if (typeof value === "object")
    return map(Object.entries(value).map(([key, item]) => [key, fromJson(item)]))
  return null
}
