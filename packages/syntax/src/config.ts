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
  if (open === null) return { keywords: [], strings: [] }
  const start = at + key.length + open[0].length
  const end = edn.indexOf(closers[open[1] ?? ""] ?? "}", start)
  const found = [...edn.slice(start, end === -1 ? undefined : end).matchAll(entry)]
  return {
    keywords: found.flatMap((match) => (match[2] === undefined ? [] : [match[2].toLowerCase()])),
    strings: found.flatMap((match) => (match[1] === undefined ? [] : [match[1].toLowerCase()])),
  }
}

export const readPropertyConfig = (configEdn: string): PropertyConfig => {
  const edn = configEdn.replace(/;[^\n]*/g, "")
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
