import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { findDisableDirectives } from "../src/directives.ts"

it("finds oxlint and eslint disable directives in workspace sources only", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seqno-directives-"))
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  write("packages/graph/src/a.ts", "const a = 1\n/* oxlint-disable */\n")
  write("features/editor/src/b.tsx", "// eslint-disable-next-line seqno/no-any\n")
  write("packages/graph/src/clean.ts", "export const disabled = true\n")
  write("packages/graph/node_modules/x/index.js", "/* eslint-disable */\n")
  write("spikes/queries/src/c.ts", "/* oxlint-disable */\n")
  expect([...findDisableDirectives(root)].toSorted()).toEqual([
    "features/editor/src/b.tsx:1",
    "packages/graph/src/a.ts:2",
  ])
})
