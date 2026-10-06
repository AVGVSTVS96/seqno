import type { GraphFile } from "./files.ts"

export const ogGeneratedSeeds: ReadonlyArray<number> = [1309, 42, 8675309]

const pageNames = ["Generated Alpha", "Generated Beta", "Generated Gamma", "Generated Delta", "Generated Epsilon", "Generated Zeta"]

const refPageNames = [
  ...pageNames,
  "Generated/Missing Namespace",
  "Generated Nested/Child",
  "Missing Alias Target",
  "Missing Tag Target",
  "Generated PDF",
]

const taskMarkers = [null, "TODO", "DOING", "DONE", "LATER", "NOW", "WAITING"]

const tags = ["generated", "import", "file-graph", "edge-case", "db-test"]

const lehmer = (seed: number) => {
  let state = seed
  const next = (n: number) => {
    state = (48271 * state) % 2147483647
    return state % n
  }
  const choice = <T>(items: ReadonlyArray<T>) => items[next(items.length)]!
  return { next, choice }
}

type Lehmer = ReturnType<typeof lehmer>

const uuid = (n: number) => `10000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

const preamble = (rng: Lehmer, pageName: string) => {
  const alias = `${pageName} Alias ${rng.next(30)}`
  const tagPage = rng.choice(refPageNames)
  const kind = rng.next(5)
  if (kind === 0)
    return `alias:: [[${alias}]], [[Missing Alias Target]]\ntags:: [[${tagPage}]], #generated-page\ngenerated-page-rank:: ${rng.next(100)}\n\n`
  if (kind === 1) return `title:: ${pageName}\npublic:: true\n\n`
  return ""
}

const titleSuffix = (rng: Lehmer) => {
  const kind = rng.next(8)
  if (kind === 0) return ` [missing asset](../assets/missing-${rng.next(50)}.pdf)`
  if (kind === 1) return ` ![missing image](../assets/missing-${rng.next(50)}.png)`
  if (kind === 2) return ` [[${rng.choice(refPageNames)}]]`
  if (kind === 3) return " #[[generated multi tag]]"
  return ""
}

const extraLines = (rng: Lehmer, index: number) => {
  const kind = rng.next(8)
  if (kind === 0) return "  collapsed:: true\n  background-color:: yellow\n"
  if (kind === 1) return `  alias:: [[Generated Block Alias ${rng.next(100)}]]\n`
  if (kind === 2) return `  | generated | table |\n  | row | ${index} |\n`
  if (kind === 3) return `  \`\`\`clojure\n  (def generated-${index} ${rng.next(100)})\n  \`\`\`\n`
  return ""
}

const block = (rng: Lehmer, index: number) => {
  const blockId = uuid(index + 1)
  const duplicateId = uuid(1)
  const marker = rng.choice(taskMarkers)
  const pageName = rng.choice(refPageNames)
  const missingPageName = `Generated Missing ${rng.next(1000)}`
  const tag = rng.choice(tags)
  const refKind = rng.next(5)
  const refId = refKind === 0 ? blockId : refKind === 1 ? duplicateId : refKind === 2 ? uuid(2000 + index) : uuid(1 + rng.next(90))
  const idKind = rng.next(11)
  const idValue = idKind === 0 ? "broken-generated-id" : idKind === 1 ? duplicateId : blockId
  const pageRef = rng.next(3) === 0 ? missingPageName : pageName
  const suffix = titleSuffix(rng)
  const temporalKind = rng.next(6)
  const temporal =
    temporalKind === 0 ? "  SCHEDULED: <2026-01-05 Mon .+1w>\n" : temporalKind === 1 ? "  DEADLINE: <2026-01-09 Fri +2d>\n" : ""
  const extra = extraLines(rng, index)
  const nested = rng.next(3) === 0 ? `  - nested generated block ${index} [[Generated Nested ${rng.next(30)}]]\n` : ""
  return (
    `- ${marker === null ? "" : `${marker} `}generated block ${index} [[${pageRef}]] ((${refId})) #${tag}${suffix}\n` +
    temporal +
    `  id:: ${idValue}\n` +
    `  generated-ref:: [[${pageName}]]\n` +
    `  generated-rank:: ${rng.next(100)}\n` +
    extra +
    nested
  )
}

const fileContent = (rng: Lehmer, fileIndex: number, pageName: string, blockCount: number) => {
  let out = preamble(rng, pageName)
  for (let i = 0; i < blockCount; i++) out += block(rng, fileIndex * 100 + i)
  return out
}

const file = (rng: Lehmer, path: string, fileIndex: number, pageName: string): GraphFile => {
  const blockCount = 8 + rng.next(8)
  return { path, content: fileContent(rng, fileIndex, pageName, blockCount) }
}

export const ogGeneratedGraph = (seed: number): GraphFile[] => {
  const rng = lehmer(seed)
  const journals = [file(rng, "journals/2026_01_05.md", 20, "2026_01_05"), file(rng, "journals/2026_01_06.md", 21, "2026_01_06")]
  const pages = pageNames.map((name, i) => file(rng, `pages/${name.toLowerCase().replaceAll(" ", "_")}.md`, i, name))
  return [
    { path: "logseq/config.edn", content: '{:preferred-format :markdown\n :journal/page-title-format "yyyy_MM_dd"}\n' },
    ...pages,
    ...journals,
    { path: "assets/generated.md", content: "Generated asset content\n" },
  ]
}

export const largeFlatGraph = (blocks = 45_000): GraphFile[] => [
  { path: "logseq/config.edn", content: "{}\n" },
  { path: "pages/large.md", content: Array.from({ length: blocks }, (_, i) => `- large line ${i} #tag\n`).join("") },
]
