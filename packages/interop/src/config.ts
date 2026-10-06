import { Option, Schema } from "effect"

export const LogseqConfig = Schema.Struct({
  journalTitleFormat: Schema.String,
  journalFileFormat: Schema.String,
  fileNameFormat: Schema.Literals(["triple-lowbar", "legacy"]),
  pagesDirectory: Schema.String,
  journalsDirectory: Schema.String,
  hidden: Schema.Array(Schema.String),
})
export type LogseqConfig = typeof LogseqConfig.Type

export const defaultConfig: LogseqConfig = {
  journalTitleFormat: "MMM do, yyyy",
  journalFileFormat: "yyyy_MM_dd",
  fileNameFormat: "triple-lowbar",
  pagesDirectory: "pages",
  journalsDirectory: "journals",
  hidden: [],
}

const ednToken = /"(?:[^"\\]|\\.)*"|;[^\n]*|#\{|[{}[\]()]|[^\s,{}[\]()";]+/g

const unquote = (token: string): string =>
  token.slice(1, -1).replace(/\\(.)/g, (_, char: string) => (char === "n" ? "\n" : char))

const topLevelEntries = (source: string): ReadonlyMap<string, unknown> => {
  const tokens = [...source.matchAll(ednToken)]
    .map((match) => match[0])
    .filter((token) => !token.startsWith(";") && !/^#[^{]/.test(token))
  const entries = new Map<string, unknown>()
  const values: Array<unknown> = []
  let depth = 0
  let collection: Array<string> = []
  for (const token of tokens) {
    if (token === "{" || token === "[" || token === "(" || token === "#{") {
      depth += 1
      if (depth === 2) collection = []
    } else if (token === "}" || token === "]" || token === ")") {
      if (depth === 2) values.push(collection)
      depth -= 1
    } else if (depth === 1) {
      values.push(token.startsWith('"') ? unquote(token) : token)
    } else if (depth === 2 && token.startsWith('"')) {
      collection.push(unquote(token))
    }
  }
  for (let index = 0; index + 1 < values.length; index += 2) {
    const key = values[index]
    if (typeof key === "string") entries.set(key, values[index + 1])
  }
  return entries
}

const decodeString = Schema.decodeUnknownOption(Schema.String)
const decodeStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))

const directory = (value: string): string => value.replace(/^\.?\/+|\/+$/g, "")

export const parseConfig = (source: string): LogseqConfig => {
  const entries = topLevelEntries(source)
  const text = (key: string, fallback: string) =>
    Option.getOrElse(decodeString(entries.get(key)), () => fallback)
  return {
    journalTitleFormat: text(":journal/page-title-format", defaultConfig.journalTitleFormat),
    journalFileFormat: text(":journal/file-name-format", defaultConfig.journalFileFormat),
    fileNameFormat: entries.get(":file/name-format") === ":triple-lowbar" ? "triple-lowbar" : "legacy",
    pagesDirectory: directory(text(":pages-directory", defaultConfig.pagesDirectory)),
    journalsDirectory: directory(text(":journals-directory", defaultConfig.journalsDirectory)),
    hidden: Option.getOrElse(decodeStrings(entries.get(":hidden")), () => []).map(directory),
  }
}

export const printConfig = (config: LogseqConfig): string =>
  [
    "{:meta/version 1",
    ` :preferred-format "Markdown"`,
    ` :file/name-format :triple-lowbar`,
    ` :journal/page-title-format ${JSON.stringify(config.journalTitleFormat)}`,
    ` :journal/file-name-format ${JSON.stringify(config.journalFileFormat)}`,
    ` :pages-directory ${JSON.stringify(config.pagesDirectory)}`,
    ` :journals-directory ${JSON.stringify(config.journalsDirectory)}}`,
    "",
  ].join("\n")
