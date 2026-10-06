import path from "node:path"
import { defineRule, type Context, type ESTree } from "@oxlint/plugins"

type Side = "domain" | "contract" | "pure" | "core" | "worker" | "ui" | "tool"

interface Unit {
  readonly name: string
  readonly side: Side
}

export const repoMap: ReadonlyMap<string, Unit> = new Map([
  ["packages/domain", { name: "@seqno/domain", side: "domain" }],
  ["packages/rpc", { name: "@seqno/rpc", side: "contract" }],
  ["packages/syntax", { name: "@seqno/syntax", side: "pure" }],
  ["packages/query", { name: "@seqno/query", side: "pure" }],
  ["packages/graph", { name: "@seqno/graph", side: "core" }],
  ["packages/index", { name: "@seqno/index", side: "core" }],
  ["packages/vault", { name: "@seqno/vault", side: "core" }],
  ["packages/interop", { name: "@seqno/interop", side: "core" }],
  ["apps/web", { name: "@seqno/web", side: "ui" }],
  ["features/outliner", { name: "@seqno/outliner", side: "ui" }],
  ["features/editor", { name: "@seqno/editor", side: "ui" }],
  ["tools/sync-sim", { name: "@seqno/sync-sim", side: "tool" }],
  ["tools/e2e", { name: "@seqno/e2e", side: "tool" }],
  ["tools/lint", { name: "@seqno/lint", side: "tool" }],
])

const workerUnit: Unit = { name: "@seqno/web core worker (apps/web/src/worker)", side: "worker" }

const byName = new Map([...repoMap.values()].map((unit) => [unit.name, unit]))

const allowed: Record<Side, ReadonlyArray<Side>> = {
  domain: [],
  contract: ["domain"],
  pure: ["domain", "pure"],
  core: ["domain", "contract", "pure", "core"],
  worker: ["domain", "contract", "pure", "core", "worker"],
  ui: ["domain", "contract", "pure", "ui"],
  tool: ["domain", "contract", "pure", "core", "worker", "ui", "tool"],
}

const isUi = (side: Side) => side === "ui"
const isCoreSide = (side: Side) => side === "core" || side === "worker"

const fixFor = (from: Unit, to: Unit): string => {
  if (isUi(from.side) && isCoreSide(to.side)) {
    return "UI code reaches the core only through @seqno/rpc: add or use an Rpc in packages/rpc and call it from the UI. Shared types belong in @seqno/domain, and pure parsing lives in @seqno/syntax or @seqno/query, which the UI may import."
  }
  if (isUi(to.side)) {
    return "Core code never imports UI code. Move the shared piece into @seqno/domain."
  }
  if (to.side === "tool") {
    return "Tools are leaves and nothing imports them. Move the shared code into the package that owns it."
  }
  if (from.side === "domain") {
    return "@seqno/domain is the root of the graph and imports no other @seqno package. Move the code into domain or depend on domain from the other side."
  }
  return `${from.name} may import only these sides: ${allowed[from.side].join(", ") || "none"}. Move the shared piece into @seqno/domain.`
}

interface Located {
  readonly folder: string
  readonly unit: Unit | undefined
  readonly inside: string
}

const locate = (relativePath: string): Located | undefined => {
  const match = /^(packages|apps|features|tools)\/([^/]+)\/?(.*)$/.exec(
    relativePath.split(path.sep).join("/"),
  )
  if (match === null) {
    return undefined
  }
  const folder = `${match[1]}/${match[2]}`
  const inside = match[3] ?? ""
  const unit =
    folder === "apps/web" && inside.startsWith("src/worker/") ? workerUnit : repoMap.get(folder)
  return { folder, unit, inside }
}

const unknownFolder = (folder: string) =>
  `${folder} is not in the repo map. Add it to repoMap in tools/lint/src/boundaries.ts and to the repo map in AGENTS.md, with the side it belongs to.`

const checkSpecifier = (
  context: Context,
  node: ESTree.Node,
  from: Located & { unit: Unit },
  specifier: string,
) => {
  if (specifier.startsWith("@seqno/")) {
    const name = specifier.split("/").slice(0, 2).join("/")
    const target = byName.get(name)
    if (target === undefined) {
      context.report({
        node,
        message: `${name} is not in the repo map. Add it to repoMap in tools/lint/src/boundaries.ts and to the repo map in AGENTS.md, or fix the package name.`,
      })
      return
    }
    report(context, node, from.unit, target)
    return
  }
  if (!specifier.startsWith(".")) {
    return
  }
  const resolved = path.relative(
    context.cwd,
    path.resolve(path.dirname(context.filename), specifier),
  )
  const target = locate(resolved)
  if (target === undefined || target.folder !== from.folder) {
    context.report({
      node,
      message: `Relative import "${specifier}" leaves ${from.folder}. Import the other package by its @seqno name and list it in ${from.folder}/package.json dependencies.`,
    })
    return
  }
  if (target.unit !== undefined) {
    report(context, node, from.unit, target.unit)
  }
}

const report = (context: Context, node: ESTree.Node, from: Unit, to: Unit) => {
  if (from.name !== to.name && !allowed[from.side].includes(to.side)) {
    context.report({
      node,
      message: `${from.name} (${from.side} side) cannot import ${to.name} (${to.side} side). ${fixFor(from, to)}`,
    })
  }
}

export const importBoundaries = defineRule({
  create: (context) => {
    const from = locate(path.relative(context.cwd, context.filename))
    if (from === undefined) {
      return {}
    }
    const { unit } = from
    if (unit === undefined) {
      return {
        Program: (node) => {
          context.report({ node, message: unknownFolder(from.folder) })
        },
      }
    }
    const here = { ...from, unit }
    const check = (node: ESTree.Node, source: ESTree.Node | null) => {
      if (source !== null && source.type === "Literal" && typeof source.value === "string") {
        checkSpecifier(context, node, here, source.value)
      }
    }
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
      TSImportType: (node) => check(node, node.source),
    }
  },
})
