import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { selectorNames } from "../packages/dom/src/selectors.ts"

const version = "0.10.9"
const out = path.join(import.meta.dirname, "../packages/dom/src/vocabulary.ts")

const filesUnder = (folder: string, extension: string): readonly string[] =>
  readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(entry.parentPath, entry.name))

const stylesheets = (root: string) => [
  ...filesUnder(path.join(root, "src/main/frontend"), ".css"),
  ...["shui.css", "tabler-extension.css", "codemirror.lsradix.css"].map((name) =>
    path.join(root, "resources/css", name),
  ),
]

const matches = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((hit) => hit[1] ?? "")

const sorted = (names: Iterable<string>) =>
  [...new Set(names)].filter((name) => name !== "").toSorted()

const read = (root: string) => {
  const selected = stylesheets(root).map((file) => selectorNames(readFileSync(file, "utf-8")))

  const components = filesUnder(path.join(root, "src/main/frontend"), ".cljs").map((file) =>
    readFileSync(file, "utf-8"),
  )

  return {
    classes: sorted(selected.flatMap((names) => names.classes)),
    ids: sorted([
      ...selected.flatMap((names) => names.ids),
      ...components.flatMap((code) => matches(code, /:[a-z][\w.-]*#([a-zA-Z][\w-]*)/gu)),
      ...components.flatMap((code) => matches(code, /:id "([a-zA-Z][\w-]*)"/gu)),
    ]),
    idPrefixes: sorted(
      components.flatMap((code) => matches(code, /:id \(str "([a-zA-Z][\w-]*-)"/gu)),
    ),
    attributes: sorted(selected.flatMap((names) => names.attributes)),
  }
}

const list = (names: readonly string[]) => `[\n${names.map((name) => `  "${name}",`).join("\n")}\n]`

const write = (root: string) => {
  const { classes, ids, idPrefixes, attributes } = read(root)
  writeFileSync(
    out,
    [
      `export const vocabularyVersion = "${version}"`,
      `export const logseqClasses: ReadonlySet<string> = new Set(${list(classes)})`,
      `export const logseqIds: ReadonlySet<string> = new Set(${list(ids)})`,
      `export const logseqIdPrefixes: ReadonlyArray<string> = ${list(idPrefixes)}`,
      `export const logseqAttributes: ReadonlySet<string> = new Set(${list(attributes)})`,
      "",
    ].join("\n\n"),
  )
  execFileSync("pnpm", ["exec", "oxfmt", out], { stdio: "inherit" })
}

const checkout = process.argv[2]

if (checkout === undefined) {
  const scratch = mkdtempSync(path.join(tmpdir(), "logseq-vocabulary-"))

  const response = await fetch(
    `https://github.com/logseq/logseq/archive/refs/tags/${version}.tar.gz`,
  )

  writeFileSync(path.join(scratch, "logseq.tar.gz"), new Uint8Array(await response.arrayBuffer()))
  execFileSync("tar", ["xzf", "logseq.tar.gz"], { cwd: scratch })
  write(path.join(scratch, `logseq-${version}`))
  rmSync(scratch, { recursive: true })
} else {
  write(checkout)
}
