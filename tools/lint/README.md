# @seqno/lint

A tool: the `seqno` oxlint plugin that enforces the repo's code rules and package boundaries, plus a guard against lint-disable comments.

## What's inside

| File                | What it does                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugin.ts`     | Registers the rules under the `seqno` name. The root `.oxlintrc.json` loads it as a JS plugin.                                  |
| `src/code-rules.ts` | `no-comments` (only comments carrying an `https://` link survive), `no-use-effect`, `no-as-cast` (except `as const`), `no-any`. |
| `src/boundaries.ts` | `import-boundaries`: which sides may import which, relative imports that leave their package, folders missing from `repoMap`.   |
| `src/directives.ts` | Fails on `oxlint-disable` / `eslint-disable` comments. `pnpm lint` runs it after oxlint.                                        |

- Every message says how to fix the problem.
- A new folder under `packages/`, `apps/`, `features/` or `tools/` has to be added to `repoMap` in `src/boundaries.ts`, with its side.

## Tests

```sh
pnpm test --project @seqno/lint
```

## Known gaps

- `fixtures/` is outside lint and format: the root ignore patterns skip it.
- Nothing stops a nested `.oxlintrc.json` from weakening a rule.
