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

const SYMBOLIC: Readonly<Record<string, number>> = {
  NaN: Number.NaN,
  Inf: Number.POSITIVE_INFINITY,
  "-Inf": Number.NEGATIVE_INFINITY,
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
    if (char === "#" && this.text[this.at + 1] === "#") {
      this.at += 2
      const symbolic = SYMBOLIC[this.token()]
      return symbolic ?? this.fail("unknown ## value")
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

type Doc =
  | { readonly _tag: "Text"; readonly text: string }
  | {
      readonly _tag: "Group"
      readonly open: string
      readonly items: ReadonlyArray<Doc>
      readonly separator: string
      readonly close: string
    }
  | { readonly _tag: "Concat"; readonly parts: ReadonlyArray<Doc> }

const textDoc = (value: string): Doc => ({ _tag: "Text", text: value })

const FIPP_QUOTES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
}

const prString = (value: string) =>
  `"${value.replace(/["\\\b\f\n\r\t]/g, (char) => FIPP_QUOTES[char] ?? char)}"`

const prNumber = (value: number) =>
  Number.isNaN(value)
    ? "##NaN"
    : value === Number.POSITIVE_INFINITY
      ? "##Inf"
      : value === Number.NEGATIVE_INFINITY
        ? "##-Inf"
        : String(value)

const collection = (
  open: string,
  items: ReadonlyArray<Doc>,
  separator: string,
  close: string,
): Doc => ({
  _tag: "Group",
  open,
  items,
  separator,
  close,
})

const docOf = (value: Edn): Doc => {
  if (value === null) return textDoc("nil")
  if (typeof value === "string") return textDoc(prString(value))
  if (typeof value === "number") return textDoc(prNumber(value))
  if (typeof value === "boolean") return textDoc(String(value))
  switch (value._tag) {
    case "Keyword":
      return textDoc(`:${value.name}`)
    case "Symbol":
      return textDoc(value.name)
    case "Tagged": {
      const form = value.value
      const compound =
        form !== null &&
        typeof form === "object" &&
        (form._tag === "Vector" ||
          form._tag === "List" ||
          form._tag === "Set" ||
          form._tag === "Map")
      return {
        _tag: "Concat",
        parts: [textDoc(`#${value.tag}${compound ? "" : " "}`), docOf(form)],
      }
    }
    case "Vector":
      return collection("[", value.items.map(docOf), "", "]")
    case "List":
      return collection("(", value.items.map(docOf), "", ")")
    case "Set":
      return collection("#{", value.items.map(docOf), "", "}")
    case "Map":
      return collection(
        "{",
        value.entries.map(([key, item]) => ({
          _tag: "Concat",
          parts: [docOf(key), textDoc(" "), docOf(item)],
        })),
        ",",
        "}",
      )
  }
}

const flatWidth = (doc: Doc): number => {
  switch (doc._tag) {
    case "Text":
      return doc.text.length
    case "Concat":
      return doc.parts.reduce((sum, part) => sum + flatWidth(part), 0)
    case "Group":
      return (
        doc.open.length +
        doc.close.length +
        doc.items.reduce((sum, item) => sum + flatWidth(item), 0) +
        Math.max(0, doc.items.length - 1) * (doc.separator.length + 1)
      )
  }
}

const layout = (
  doc: Doc,
  column: number,
  flat: boolean,
  width: number,
  out: Array<string>,
): number => {
  switch (doc._tag) {
    case "Text":
      out.push(doc.text)
      return column + doc.text.length
    case "Concat":
      return doc.parts.reduce((at, part) => layout(part, at, flat, width, out), column)
    case "Group": {
      const fits = flat || column + flatWidth(doc) <= width
      out.push(doc.open)
      const align = column + doc.open.length
      let at = align
      doc.items.forEach((item, index) => {
        if (index > 0) {
          out.push(doc.separator)
          at += doc.separator.length
          if (fits) {
            out.push(" ")
            at += 1
          } else {
            out.push(`\n${" ".repeat(align)}`)
            at = align
          }
        }
        at = layout(item, at, fits, width, out)
      })
      out.push(doc.close)
      return at + doc.close.length
    }
  }
}

export const printFipp = (value: Edn, width = 70): string => {
  const out: Array<string> = []
  layout(docOf(value), 0, false, width, out)
  return `${out.join("")}\n`
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

export const murmurInt = (value: number) => (value === 0 ? 0 : fmix(mixH1(0, mixK1(value)), 4))

export const javaHash = (text: string) => {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = imul(31, hash) + text.charCodeAt(index)
  }
  return hash
}

export const cljsStringHash = (text: string): number => murmurInt(javaHash(text))
