import { Predicate, Schema } from "effect"

export const LogseqConfig = Schema.Struct({
  journalTitleFormat: Schema.String,
  journalFileFormat: Schema.String,
  fileNameFormat: Schema.Literals(["triple-lowbar", "legacy"]),
  pagesDirectory: Schema.String,
  journalsDirectory: Schema.String,
  whiteboardsDirectory: Schema.String,
  hidden: Schema.Array(Schema.String),
  preferredFormat: Schema.Literals(["markdown", "org"]),
})

export type LogseqConfig = typeof LogseqConfig.Type

export const defaultConfig: LogseqConfig = {
  journalTitleFormat: "MMM do, yyyy",
  journalFileFormat: "yyyy_MM_dd",
  fileNameFormat: "triple-lowbar",
  pagesDirectory: "pages",
  journalsDirectory: "journals",
  whiteboardsDirectory: "whiteboards",
  hidden: [],
  preferredFormat: "markdown",
}

const ednToken = /"(?:[^"\\]|\\.)*"|;[^\n]*|#\{|[{}[\]()]|[^\s,{}[\]()";]+/gu

const unquote = (token: string): string =>
  token.slice(1, -1).replaceAll(/\\(.)/gu, (_, char: string) => (char === "n" ? "\n" : char))

type ConfigValue = string | readonly string[]

const isList = (value: ConfigValue | undefined): value is readonly string[] => Array.isArray(value)

const isSkipped = (token: string) => token.startsWith(";") || /^#[^{]/u.test(token)

const topLevelEntries = (source: string): ReadonlyMap<string, ConfigValue> => {
  const tokens = [...source.matchAll(ednToken)].flatMap(([token]) =>
    isSkipped(token) ? [] : [token],
  )

  const entries = new Map<string, ConfigValue>()
  const values: ConfigValue[] = []
  let depth = 0
  let collection: string[] = []

  for (const token of tokens) {
    if (token === "{" || token === "[" || token === "(" || token === "#{") {
      depth += 1

      if (depth === 2) {
        collection = []
      }
    } else if (token === "}" || token === "]" || token === ")") {
      if (depth === 2) {
        values.push(collection)
      }

      depth -= 1
    } else if (depth === 1) {
      values.push(token.startsWith('"') ? unquote(token) : token)
    } else if (depth === 2 && token.startsWith('"')) {
      collection.push(unquote(token))
    }
  }

  for (let index = 0; index + 1 < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]

    if (Predicate.isString(key) && value !== undefined) {
      entries.set(key, value)
    }
  }

  return entries
}

const directory = (value: string): string => value.replaceAll(/^\.?\/+|\/+$/gu, "")

export const parseConfig = (source: string): LogseqConfig => {
  const entries = topLevelEntries(source)

  const text = (key: string, fallback: string) => {
    const value = entries.get(key)

    return Predicate.isString(value) ? value : fallback
  }

  const hidden = entries.get(":hidden")

  return {
    journalTitleFormat: text(":journal/page-title-format", defaultConfig.journalTitleFormat),
    journalFileFormat: text(":journal/file-name-format", defaultConfig.journalFileFormat),
    fileNameFormat:
      entries.get(":file/name-format") === ":triple-lowbar" ? "triple-lowbar" : "legacy",
    pagesDirectory: directory(text(":pages-directory", defaultConfig.pagesDirectory)),
    journalsDirectory: directory(text(":journals-directory", defaultConfig.journalsDirectory)),
    whiteboardsDirectory: directory(
      text(":whiteboards-directory", defaultConfig.whiteboardsDirectory),
    ),
    hidden: (isList(hidden) ? hidden : []).map(directory),
    preferredFormat:
      text(":preferred-format", "Markdown").toLowerCase() === "org" ? "org" : "markdown",
  }
}

export const printConfig = (config: LogseqConfig): string =>
  [
    "{:meta/version 1",
    ` :preferred-format ${config.preferredFormat === "org" ? '"Org"' : '"Markdown"'}`,
    ` :file/name-format :triple-lowbar`,
    ` :journal/page-title-format ${JSON.stringify(config.journalTitleFormat)}`,
    ` :journal/file-name-format ${JSON.stringify(config.journalFileFormat)}`,
    ` :pages-directory ${JSON.stringify(config.pagesDirectory)}`,
    ` :journals-directory ${JSON.stringify(config.journalsDirectory)}}`,
    "",
  ].join("\n")
