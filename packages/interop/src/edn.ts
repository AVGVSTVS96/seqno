import { javaHash, murmurChars, murmurInt, readEdn } from "@seqno/syntax"
import type { Edn } from "@seqno/syntax"

export { murmurChars, readEdn, type Edn }

export const keyword = (name: string): Edn => ({ _tag: "Keyword", name })
export const uuid = (value: string): Edn => ({ _tag: "Tagged", tag: "uuid", value })
export const vector = (items: readonly Edn[]): Edn => ({ _tag: "Vector", items })
export const list = (items: readonly Edn[]): Edn => ({ _tag: "List", items })

export const map = (entries: ReadonlyArray<readonly [string, Edn]>): Edn => ({
  _tag: "Map",
  entries: entries.map(([key, value]) => [keyword(key), value]),
})

const printNumber = (value: number) =>
  Number.isNaN(value)
    ? "##NaN"
    : value === Number.POSITIVE_INFINITY
      ? "##Inf"
      : value === Number.NEGATIVE_INFINITY
        ? "##-Inf"
        : String(value)

const hashCombine = (seed: number, hash: number) =>
  seed ^ (hash + 0x9e_37_79_b9 + (seed << 6) + (seed >> 2))

const keywordHash = (name: string) => {
  const parts = name.split("/")
  const [ns, local] = parts.length === 2 ? parts : [null, name]

  return (
    (hashCombine(murmurChars(local ?? name), ns === null ? 0 : javaHash(ns)) + 0x9e_37_79_b9) | 0
  )
}

const keyHash = (key: Edn): number | null => {
  if (typeof key === "string") {
    return murmurInt(javaHash(key))
  }

  if (key !== null && typeof key === "object" && key._tag === "Keyword") {
    return keywordHash(key.name)
  }

  return null
}

const HASHMAP_THRESHOLD = 8

const levels = (hash: number) =>
  Array.from({ length: 7 }, (_, level) => (hash >>> (level * 5)) & 31)

export const hashOrder = (
  entries: ReadonlyArray<readonly [Edn, Edn]>,
  always = false,
): ReadonlyArray<readonly [Edn, Edn]> => {
  if (!always && entries.length <= HASHMAP_THRESHOLD) {
    return entries
  }

  const keyed = entries.map((entry) => ({ entry, hash: keyHash(entry[0]) }))

  if (keyed.some(({ hash }) => hash === null)) {
    return entries
  }

  return keyed
    .toSorted((a, b) => {
      const left = levels(a.hash ?? 0)
      const right = levels(b.hash ?? 0)
      const level = left.findIndex((chunk, index) => chunk !== right[index])

      return level === -1 ? 0 : (left[level] ?? 0) - (right[level] ?? 0)
    })
    .map(({ entry }) => entry)
}

const QUOTED = /["\\\b\f\n\r\t]/gu

const QUOTES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
}

const quote = (text: string) => `"${text.replaceAll(QUOTED, (char) => QUOTES[char] ?? char)}"`

export const printEdn = (value: Edn): string => {
  if (value === null) {
    return "nil"
  }

  if (typeof value === "string") {
    return quote(value)
  }

  if (typeof value === "number") {
    return printNumber(value)
  }

  if (typeof value === "boolean") {
    return String(value)
  }

  switch (value._tag) {
    case "Keyword": {
      return `:${value.name}`
    }

    case "Symbol": {
      return value.name
    }

    case "Tagged": {
      return `#${value.tag} ${printEdn(value.value)}`
    }

    case "Vector": {
      return `[${value.items.map(printEdn).join(" ")}]`
    }

    case "List": {
      return `(${value.items.map(printEdn).join(" ")})`
    }

    case "Set": {
      return `#{${value.items.map(printEdn).join(" ")}}`
    }

    case "Map": {
      return `\n{${hashOrder(value.entries)
        .map(([key, item]) => `${printEdn(key)} ${printEdn(item)}`)
        .join("\n")}}`
    }
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
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined || typeof value !== "object") {
    return null
  }

  if (value._tag === "Keyword" || value._tag === "Symbol") {
    return value.name
  }

  return value._tag === "Tagged" ? textOf(value.value) : null
}

export const itemsOf = (value: Edn | undefined): readonly Edn[] =>
  value !== null &&
  value !== undefined &&
  typeof value === "object" &&
  (value._tag === "List" || value._tag === "Vector" || value._tag === "Set")
    ? value.items
    : []

export type Json = string | number | boolean | null | readonly Json[] | JsonObject

export interface JsonObject {
  readonly [key: string]: Json
}

export const toJson = (value: Edn): Json => {
  if (value === null || typeof value !== "object") {
    return value
  }

  switch (value._tag) {
    case "Keyword":
    case "Symbol": {
      return value.name
    }

    case "Tagged": {
      return toJson(value.value)
    }

    case "Vector":
    case "List":
    case "Set": {
      return value.items.map(toJson)
    }

    case "Map": {
      return Object.fromEntries(
        value.entries.map(([key, item]) => [textOf(key) ?? printEdn(key), toJson(item)]),
      )
    }
  }
}

export const fromJson = (value: unknown): Edn => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (Array.isArray(value)) {
    return vector(value.map(fromJson))
  }

  if (typeof value === "object") {
    return map(Object.entries(value).map(([key, item]) => [key, fromJson(item)]))
  }

  return null
}
