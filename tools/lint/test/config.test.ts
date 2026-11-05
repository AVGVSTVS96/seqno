import { execFileSync } from "node:child_process"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const root = join(import.meta.dirname, "../../..")
const probes: Record<string, string> = {
  "features/editor/src/lint-probe.tsx":
    'import { useEffect } from "react"\nimport { openGraph } from "@seqno/graph"\nexport const probe = [useEffect, openGraph]\n',
  "apps/web/src/lint-probe.ts":
    'import { boot } from "./worker/main.ts"\nexport const probe = boot\n',
  "apps/web/src/worker/lint-probe.ts":
    'import { Outliner } from "@seqno/outliner"\nexport const probe = Outliner\n',
  "packages/domain/src/lint-probe.ts":
    'import { CoreRpcs } from "@seqno/rpc"\nexport const probe = CoreRpcs\n',
  "packages/syntax/src/lint-probe.ts": "export const probe = (value: any) => value as string\n",
}

interface Diagnostic {
  readonly code: string
  readonly help?: string
  readonly filename: string
}

const isReport = (value: unknown): value is { diagnostics: readonly Diagnostic[] } =>
  value !== null && typeof value === "object" && "diagnostics" in value

const lint = (): readonly Diagnostic[] => {
  for (const [file, code] of Object.entries(probes)) {
    writeFileSync(join(root, file), code)
  }

  const run = () => {
    try {
      return execFileSync("pnpm", ["exec", "oxlint", "--format", "json", ...Object.keys(probes)], {
        cwd: root,
        encoding: "utf8",
      })
    } catch (error) {
      return error instanceof Error && "stdout" in error ? String(error.stdout) : "{}"
    }
  }

  const report: unknown = JSON.parse(run())

  return isReport(report) ? report.diagnostics : []
}

describe("oxlint.config.ts", () => {
  const diagnostics = lint()
  const errorsIn = (file: string) =>
    diagnostics
      .filter((diagnostic) => diagnostic.filename === file)
      .map((diagnostic) => `${diagnostic.code} ${diagnostic.help ?? ""}`)

  afterAll(() => {
    for (const file of Object.keys(probes)) {
      rmSync(join(root, file), { force: true })
    }
  })

  it("keeps UI code off useEffect and off the core packages", () => {
    const errors = errorsIn("features/editor/src/lint-probe.tsx").join("\n")
    expect(errors).toContain("Derive the value during render")
    expect(errors).toContain("UI code reaches the core only through @seqno/rpc")
  })

  it("keeps the app's UI from importing its worker", () => {
    expect(errorsIn("apps/web/src/lint-probe.ts").join("\n")).toContain(
      "UI code reaches the core only through @seqno/rpc",
    )
  })

  it("keeps the worker off UI packages", () => {
    expect(errorsIn("apps/web/src/worker/lint-probe.ts").join("\n")).toContain(
      "The worker is the core side of the app and never imports UI code",
    )
  })

  it("keeps @seqno/domain the root of the graph", () => {
    expect(errorsIn("packages/domain/src/lint-probe.ts").join("\n")).toContain(
      "@seqno/domain is the root of the graph",
    )
  })

  it("bans any and type assertions", () => {
    const errors = errorsIn("packages/syntax/src/lint-probe.ts").join("\n")
    expect(errors).toContain("no-explicit-any")
    expect(errors).toContain("consistent-type-assertions")
  })
})
