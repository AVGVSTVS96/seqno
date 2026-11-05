import { Result } from "effect"
import { readEdn } from "./edn.ts"

export interface PropertyConfig {
  readonly listKeys: ReadonlySet<string>
  readonly unparsedKeys: ReadonlySet<string>
}

const builtInLists = ["tags", "alias"]

export const defaultPropertyConfig: PropertyConfig = {
  listKeys: new Set(builtInLists),
  unparsedKeys: new Set(),
}

const closers: Readonly<Record<string, string>> = { "#{": "}", "[": "]", "(": ")" }
const entry = /"((?:[^"\\]|\\.)*)"|:([^\s,"[\](){}]+)/g

const entriesOf = (edn: string, key: string) => {
  const at = edn.indexOf(key)
  const open = at === -1 ? null : /^\s*(#\{|\[|\()/.exec(edn.slice(at + key.length))

  if (open === null) {
    return { keywords: [], strings: [] }
  }

  const start = at + key.length + open[0].length
  const end = edn.indexOf(closers[open[1] ?? ""] ?? "}", start)
  const found = [...edn.slice(start, end === -1 ? undefined : end).matchAll(entry)]

  return {
    keywords: found.flatMap((match) => (match[2] === undefined ? [] : [match[2].toLowerCase()])),
    strings: found.flatMap((match) => (match[1] === undefined ? [] : [match[1].toLowerCase()])),
  }
}

export const readPropertyConfig = (configEdn: string): PropertyConfig => {
  const edn = configEdn.replaceAll(/;[^\n]*/g, "")

  return {
    listKeys: new Set([
      ...builtInLists,
      ...entriesOf(edn, ":property/separated-by-commas").keywords,
    ]),
    unparsedKeys: new Set(entriesOf(edn, ":ignored-page-references-keywords").strings),
  }
}

export const propertyConfigKey = ({ listKeys, unparsedKeys }: PropertyConfig): string =>
  JSON.stringify([[...listKeys].toSorted(), [...unparsedKeys].toSorted()])

const flagPattern = (key: string) =>
  new RegExp(`^([^;\\n]*?)${key.replaceAll(/[?/.]/g, "\\$&")}\\s+(true|false)\\b`, "m")

export const readConfigFlag = (configEdn: string, key: string, fallback: boolean): boolean => {
  const found = flagPattern(key).exec(configEdn)

  return found === null ? fallback : found[2] === "true"
}

export const writeConfigFlag = (configEdn: string, key: string, value: boolean): string => {
  const pattern = flagPattern(key)

  if (pattern.test(configEdn)) {
    return configEdn.replace(pattern, `$1${key} ${value}`)
  }

  const end = configEdn.lastIndexOf("}")

  return end === -1
    ? `{${key} ${value}}\n`
    : `${configEdn.slice(0, end)}\n ${key} ${value}${configEdn.slice(end)}`
}

export const readConfigString = (configEdn: string, key: string): string | null => {
  const edn = Result.getOrElse(readEdn(configEdn), () => null)

  if (edn === null || typeof edn !== "object" || edn._tag !== "Map") {
    return null
  }

  const found = edn.entries.find(
    ([name]) =>
      name !== null &&
      typeof name === "object" &&
      name._tag === "Keyword" &&
      `:${name.name}` === key,
  )?.[1]

  return typeof found === "string" ? found : null
}
