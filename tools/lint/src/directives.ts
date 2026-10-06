import { globSync, readFileSync } from "node:fs"

const directive = /\b(?:oxlint|eslint)-(?:disable|enable)\b/

export const findDisableDirectives = (root: string): ReadonlyArray<string> =>
  globSync("{packages,apps,features,tools}/*/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", {
    cwd: root,
    exclude: (path) => path.includes("node_modules") || path.includes("tools/lint/test"),
  }).flatMap((file) =>
    readFileSync(`${root}/${file}`, "utf8")
      .split("\n")
      .flatMap((line, index) => (directive.test(line) ? [`${file}:${index + 1}`] : [])),
  )

if (import.meta.main) {
  const found = findDisableDirectives(process.cwd())
  for (const location of found) {
    console.error(
      `${location}: lint disable directives are not allowed. Fix the code so the rule passes; if a rule blocks real work, report it instead of silencing it.`,
    )
  }
  process.exitCode = found.length === 0 ? 0 : 1
}
