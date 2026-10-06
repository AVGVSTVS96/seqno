import path from "node:path"
import { describe, it } from "vitest"
import { RuleTester } from "oxlint/plugins-dev"
import { importBoundaries } from "../src/boundaries.ts"
import { noAny, noAsCast, noComments, noUseEffect } from "../src/code-rules.ts"

RuleTester.describe = describe
RuleTester.it = it

const cwd = "/repo"
const at = (file: string) => path.join(cwd, file)
const tester = new RuleTester({ cwd, languageOptions: { parserOptions: { lang: "tsx" } } })

tester.run("no-comments", noComments, {
  valid: [
    "const total = 1",
    "// https://github.com/loro-dev/loro/issues/1 tree moves drop the fractional index\nconst x = 1",
  ],
  invalid: [
    { code: "// increments the counter\nconst x = 1", errors: [/^Code comments are not allowed/] },
    { code: "/** docs */\nexport const x = 1", errors: 1 },
    { code: "// oxlint-disable-next-line\nconst x = 1", errors: 1 },
  ],
})

tester.run("no-use-effect", noUseEffect, {
  valid: ["import { useState } from 'react'\nuseState(0)"],
  invalid: [
    {
      code: "import { useEffect } from 'react'\nuseEffect(() => {}, [])",
      errors: [
        {
          line: 1,
          message:
            "useEffect is not allowed. Derive the value during render, do the work in the event handler that caused the change, or read outside state through an @effect/atom-react atom (useAtomValue, useAtomSet).",
        },
        { line: 2, message: /^useEffect is not allowed/ },
      ],
    },
    {
      code: "import * as React from 'react'\nReact.useLayoutEffect(() => {})",
      errors: [/^useLayoutEffect is not allowed/],
    },
  ],
})

tester.run("no-as-cast", noAsCast, {
  valid: ["const tags = ['a', 'b'] as const", "const n = 1 satisfies number"],
  invalid: [
    { code: "const n = value as number", errors: [/^Type assertions are not allowed/] },
    {
      code: "const n = <number>value",
      errors: 1,
      languageOptions: { parserOptions: { lang: "ts" } },
    },
    { code: "const n = value as unknown as string", errors: 2 },
  ],
})

tester.run("no-any", noAny, {
  valid: ["const n: unknown = 1"],
  invalid: [
    {
      code: "const n: any = 1",
      errors: [
        "'any' is not allowed. Use 'unknown' and decode it with Schema, or write the real type.",
      ],
    },
    { code: "type Bag = Array<any>", errors: 1 },
  ],
})

tester.run("import-boundaries", importBoundaries, {
  valid: [
    {
      code: "import { BlockId } from '@seqno/domain'",
      filename: at("features/outliner/src/tree.tsx"),
    },
    { code: "import { CoreRpcs } from '@seqno/rpc'", filename: at("apps/web/src/main.tsx") },
    { code: "import { Graph } from '@seqno/graph'", filename: at("apps/web/src/worker/main.ts") },
    {
      code: "import { parse } from '@seqno/syntax'",
      filename: at("packages/index/src/indexer.ts"),
    },
    { code: "import { Vault } from '@seqno/vault'", filename: at("tools/sync-sim/src/run.ts") },
    { code: "import { tree } from './tree.ts'", filename: at("packages/graph/src/graph.ts") },
    { code: "import { Effect } from 'effect'", filename: at("packages/domain/src/ids.ts") },
    { code: "import { x } from '@seqno/graph'", filename: at("vitest.config.ts") },
  ],
  invalid: [
    {
      code: "import { Graph } from '@seqno/graph'",
      filename: at("features/editor/src/editor.tsx"),
      errors: [
        "@seqno/editor (ui side) cannot import @seqno/graph (core side). UI code reaches the core only through @seqno/rpc: add or use an Rpc in packages/rpc and call it from the UI. Shared types belong in @seqno/domain.",
      ],
    },
    {
      code: "export * from '@seqno/outliner'",
      filename: at("packages/graph/src/graph.ts"),
      errors: [
        /^@seqno\/graph \(core side\) cannot import @seqno\/outliner \(ui side\)\. Core code never imports UI code/,
      ],
    },
    {
      code: "const graph = import('@seqno/index')",
      filename: at("apps/web/src/main.tsx"),
      errors: [/cannot import @seqno\/index \(core side\)/],
    },
    {
      code: "import { boot } from './worker/main.ts'",
      filename: at("apps/web/src/main.tsx"),
      errors: [/^@seqno\/web \(ui side\) cannot import @seqno\/web core worker/],
    },
    {
      code: "import { BlockId } from '../../domain/src/ids.ts'",
      filename: at("packages/graph/src/graph.ts"),
      errors: [
        /^Relative import "\.\.\/\.\.\/domain\/src\/ids\.ts" leaves packages\/graph\. Import the other package by its @seqno name/,
      ],
    },
    {
      code: "import { Rpcs } from '@seqno/rpc'",
      filename: at("packages/domain/src/command.ts"),
      errors: [
        /^@seqno\/domain \(domain side\) cannot import @seqno\/rpc \(contract side\)\. @seqno\/domain is the root/,
      ],
    },
    {
      code: "import { run } from '@seqno/sync-sim'",
      filename: at("packages/vault/src/vault.ts"),
      errors: [/Tools are leaves and nothing imports them/],
    },
    {
      code: "import { x } from '@seqno/nope'",
      filename: at("packages/graph/src/graph.ts"),
      errors: [
        /^@seqno\/nope is not in the repo map\. Add it to repoMap in tools\/lint\/src\/boundaries\.ts/,
      ],
    },
    {
      code: "export const x = 1",
      filename: at("packages/mystery/src/x.ts"),
      errors: [/^packages\/mystery is not in the repo map/],
    },
  ],
})
