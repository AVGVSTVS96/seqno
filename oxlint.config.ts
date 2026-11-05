import { defineConfig } from "oxlint"
import antiSlop from "ultracite/oxlint/anti-slop"
import core from "ultracite/oxlint/core"
import react from "ultracite/oxlint/react"
import vitest from "ultracite/oxlint/vitest"

type Side = "domain" | "contract" | "pure" | "core" | "ui" | "tool"

const packages: Record<Side, ReadonlyArray<string>> = {
  domain: ["domain"],
  contract: ["rpc"],
  pure: ["syntax", "query", "export", "dom"],
  core: ["graph", "index", "vault", "interop", "git"],
  ui: ["web", "site", "outliner", "editor", "plugins", "whiteboard", "pdf"],
  tool: ["sync-sim", "e2e", "lint", "bench", "fixtures", "brand"],
}

const uiToCore =
  "UI code reaches the core only through @seqno/rpc: add or use an Rpc in packages/rpc and call it from the UI. Shared types belong in @seqno/domain, and pure parsing in @seqno/syntax or @seqno/query."

const sides: ReadonlyArray<{
  files: Array<string>
  forbidden: ReadonlyArray<Side>
  message: string
}> = [
  {
    files: ["packages/domain/**"],
    forbidden: ["contract", "pure", "core", "ui", "tool"],
    message: "@seqno/domain is the root of the graph and imports no other @seqno package.",
  },
  {
    files: ["packages/rpc/**"],
    forbidden: ["pure", "core", "ui", "tool"],
    message: "@seqno/rpc is the contract and imports only @seqno/domain.",
  },
  {
    files: ["packages/{syntax,query,export,dom}/**"],
    forbidden: ["contract", "core", "ui", "tool"],
    message: "Pure packages import only @seqno/domain and other pure packages.",
  },
  {
    files: ["packages/{graph,index,vault,interop,git}/**"],
    forbidden: ["ui", "tool"],
    message: "Core code never imports UI code. Move the shared piece into @seqno/domain.",
  },
  { files: ["apps/**", "features/**"], forbidden: ["core", "tool"], message: uiToCore },
  {
    files: ["apps/web/src/worker/**"],
    forbidden: ["ui", "tool"],
    message: "The worker is the core side of the app and never imports UI code.",
  },
]

const effectHooks = {
  name: "react",
  importNames: ["useEffect", "useLayoutEffect", "useInsertionEffect"],
  message:
    "Derive the value during render, do the work in the event handler that caused the change, or read outside state through an @effect/atom-react atom (useAtomValue, useAtomSet).",
}

const restrictImports = (forbidden: ReadonlyArray<Side>, message: string) => [
  "error",
  {
    paths: [effectHooks],
    patterns: [
      {
        group: forbidden.flatMap((side) =>
          packages[side].flatMap((name) => [`@seqno/${name}`, `@seqno/${name}/*`]),
        ),
        message,
      },
    ],
  },
]

export default defineConfig({
  extends: [core, react, vitest, antiSlop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".claude/**",
    "fixtures/**",
    "brand/**",
    "tools/lint/anti-slop-effect/**",
  ],
  jsPlugins: [
    { name: "no-comments", specifier: "./tools/lint/src/no-comments.ts" },
    { name: "seqno", specifier: "./tools/lint/src/plugin.ts" },
    { name: "anti-slop-effect", specifier: "./tools/lint/anti-slop-effect/index.ts" },
  ],
  options: { typeAware: true, reportUnusedDisableDirectives: "error" },
  rules: {
    "no-comments/no-comments": "error",
    "oxc/no-accumulating-spread": "error",
    "import/no-cycle": "error",
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    "no-restricted-imports": ["error", { paths: [effectHooks] }],
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
  },
  overrides: [
    ...sides.map(({ files, forbidden, message }) => ({
      files,
      rules: { "no-restricted-imports": restrictImports(forbidden, message) },
    })),
    {
      files: ["apps/web/src/**/*.{ts,tsx}", "features/*/src/**/*.{ts,tsx}"],
      rules: { "seqno/logseq-names": "error" },
    },
  ],
})
