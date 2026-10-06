import { fileURLToPath } from "node:url"
import type { GraphFile } from "./files.ts"
import { largeFlatGraph, ogGeneratedGraph } from "./og-generated.ts"

export type CaseSource =
  | { readonly _tag: "Committed"; readonly dir: string }
  | { readonly _tag: "Generated"; readonly files: () => ReadonlyArray<GraphFile> }

export interface EdgeCase {
  readonly name: string
  readonly upstreamCase: string | null
  readonly issues: ReadonlyArray<string>
  readonly expect: string
  readonly source: CaseSource
}

export const graphsDir = fileURLToPath(new URL("../graphs/", import.meta.url))

const committed = (name: string): CaseSource => ({ _tag: "Committed", dir: fileURLToPath(new URL(`../graphs/${name}/`, import.meta.url)) })

const generated = (files: () => ReadonlyArray<GraphFile>): CaseSource => ({ _tag: "Generated", files })

const ogGenerated = (seed: number, source: CaseSource): EdgeCase => ({
  name: `og-generated-${seed}`,
  upstreamCase: "Generated Markdown file graphs",
  issues: [],
  expect: "imports without throwing; invalid ids and refs are repaired; at least 60 'generated block' blocks survive",
  source,
})

export const edgeCases: ReadonlyArray<EdgeCase> = [
  {
    name: "legacy-journal-file-refs",
    upstreamCase: "Legacy journal filename refs",
    issues: ["db-test#906"],
    expect: "[[2026_04_02]] resolves to the 2026-04-02 journal even from a file read first; [[2026_04_03]] and [[May 19th, 2021]] have no journal file and become ordinary pages",
    source: committed("legacy-journal-file-refs"),
  },
  {
    name: "missing-block-refs",
    upstreamCase: "Missing block refs",
    issues: ["db-test#213", "db-test#340", "db-test#679", "db-test#748", "db-test#927"],
    expect: "refs and embeds to absent blocks are dropped without placeholders; blocks left with an empty title keep their properties and children",
    source: committed("missing-block-refs"),
  },
  {
    name: "forward-block-refs",
    upstreamCase: "Forward block refs",
    issues: ["db-test#850", "db-test#927"],
    expect: "refs, embeds and property refs to blocks in files imported later all resolve",
    source: committed("forward-block-refs"),
  },
  {
    name: "duplicated-block-ids",
    upstreamCase: "Duplicated block ids",
    issues: [],
    expect: "the first block keeps aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa, later duplicates (same file and other file) get new ids; uppercase ids compare equal to lowercase; not-a-uuid is replaced",
    source: committed("duplicated-block-ids"),
  },
  ogGenerated(1309, committed("og-generated-1309")),
  ogGenerated(42, generated(() => ogGeneratedGraph(42))),
  ogGenerated(8675309, generated(() => ogGeneratedGraph(8675309))),
  {
    name: "recursive-block-refs",
    upstreamCase: "Recursive block refs",
    issues: [],
    expect: "self refs, self embeds, two-block cycles and parent embeds import without recursive self-references or infinite loops",
    source: committed("recursive-block-refs"),
  },
  {
    name: "missing-pages",
    upstreamCase: "Missing pages",
    issues: [],
    expect: "each referenced page without a file is created once (case-insensitive); [[2025_02_30]] and [[Feb 3rd, 2025]] become ordinary pages",
    source: committed("missing-pages"),
  },
  {
    name: "repeated-temporal",
    upstreamCase: "Mixed repeated deadline and scheduled timestamps",
    issues: ["db-test#318"],
    expect: "both dates are kept; the repeat cookie (.+1y, +2w, .+1w, ++3d, +1m) stays attached to the timestamp that carried it",
    source: committed("repeated-temporal"),
  },
  {
    name: "linked-external-pdf",
    upstreamCase: "Linked external PDF annotations",
    issues: ["db-test#923"],
    expect: "each file:// PDF becomes an external asset keeping its URL; hls__ annotations bind to it, including .PDF and highlights with missing attributes",
    source: committed("linked-external-pdf"),
  },
  {
    name: "external-pdf-windows-https",
    upstreamCase: "Windows and remote HTTPS linked PDF annotations",
    issues: ["db-test#1140"],
    expect: "Windows drive, https, and query/fragment URLs are kept verbatim; HlsOnlyDoc is only named by its hls__ page and still binds",
    source: committed("external-pdf-windows-https"),
  },
  {
    name: "missing-local-pdf",
    upstreamCase: "Missing local PDF asset links",
    issues: [],
    expect: "links to absent files under assets/ are reported as ignored assets and the import continues quietly",
    source: committed("missing-local-pdf"),
  },
  {
    name: "large-flat-file",
    upstreamCase: "Large flat files",
    issues: ["db-test#931"],
    expect: "45,000 top-level blocks in one file import without stack overflow",
    source: generated(() => largeFlatGraph()),
  },
  {
    name: "empty-files",
    upstreamCase: "Empty imported files",
    issues: ["db-test#582"],
    expect: "0-byte and 1-byte journals and pages (and an empty .org file) import as empty pages or are skipped, and the rest of the graph imports",
    source: committed("empty-files"),
  },
  {
    name: "og-syntax-mix",
    upstreamCase: null,
    issues: [],
    expect: "headings, every task marker, queries, namespaces (triple-lowbar and %2F file names), aliases, title:: overrides, CRLF, NFD file names, space indentation and a missing final newline all round-trip",
    source: committed("og-syntax-mix"),
  },
]

export const edgeCase = (name: string) => edgeCases.find((c) => c.name === name)
