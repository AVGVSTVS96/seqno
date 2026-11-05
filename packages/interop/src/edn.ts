import { javaHash, murmurChars, murmurInt } from "@seqno/syntax"
import type { Edn } from "@seqno/syntax"
import { Predicate } from "effect"
import type { Schema } from "effect"

export { murmurChars, readEdn, type Edn } from "@seqno/syntax"

type EdnNode = Exclude<Edn, string | number | boolean | null>

const isNode = (value: Edn | undefined): value is EdnNode => Predicate.isObject(value)

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

  return Math.trunc(
    hashCombine(murmurChars(local ?? name), ns === null ? 0 : javaHash(ns)) + 0x9e_37_79_b9,
  )
}

const keyHash = (key: Edn): number | null => {
  if (Predicate.isString(key)) {
    return murmurInt(javaHash(key))
  }

  if (isNode(key) && key._tag === "Keyword") {
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

const QUOTES = new Map([
  ['"', '\\"'],
  ["\\", "\\\\"],
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
])

const quote = (text: string) => `"${text.replaceAll(QUOTED, (char) => QUOTES.get(char) ?? char)}"`

export const printEdn = (value: Edn): string => {
  if (value === null) {
    return "nil"
  }

  if (Predicate.isString(value)) {
    return quote(value)
  }

  if (Predicate.isNumber(value)) {
    return printNumber(value)
  }

  if (Predicate.isBoolean(value)) {
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
  isNode(value) && value._tag === "Map" ? value.entries : []

export const entriesOf = (value: Edn): ReadonlyMap<string, Edn> =>
  new Map(
    isNode(value) && value._tag === "Map"
      ? value.entries.flatMap(([key, item]) => {
          const name = textOf(key)

          return name === null ? [] : [[name, item] as const]
        })
      : [],
  )

export const textOf = (value: Edn | undefined): string | null => {
  if (Predicate.isString(value)) {
    return value
  }

  if (!isNode(value)) {
    return null
  }

  if (value._tag === "Keyword" || value._tag === "Symbol") {
    return value.name
  }

  return value._tag === "Tagged" ? textOf(value.value) : null
}

export const itemsOf = (value: Edn | undefined): readonly Edn[] =>
  isNode(value) && (value._tag === "List" || value._tag === "Vector" || value._tag === "Set")
    ? value.items
    : []

export const toJson = (value: Edn): Schema.Json => {
  if (!isNode(value)) {
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

export const isJsonArray = (value: Schema.Json | undefined): value is Schema.JsonArray =>
  Array.isArray(value)

export const isJsonObject = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  Predicate.isObject(value)

export const fromJson = (value: Schema.Json): Edn => {
  if (isJsonArray(value)) {
    return vector(value.map(fromJson))
  }

  if (isJsonObject(value)) {
    return map(Object.entries(value).map(([key, item]) => [key, fromJson(item)]))
  }

  if (Predicate.isNumber(value)) {
    return Number.isFinite(value) ? value : null
  }

  return value
}
