# @seqno/e2e

A tool: Playwright flows that drive the built web app in headless Chrome, plus a design harness that screenshots seqno next to Logseq, scene by scene.

## What's inside

| Path             | What it holds                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `flows/*.e2e.ts` | User flows: onboarding, startup, journals, editing, blocks, embeds, history, pages, queries, import, and self-tests of the harness. |
| `src/test.ts`    | The shared `test`: fails any test whose page throws an uncaught error, and holds role-based locators.                               |
| `src/opfs.ts`    | `seedOpfs`, `loadGraphFolder`, `opfsFiles`, `fixtureGraph`: put fixture graphs into OPFS or behind the folder picker.               |
| `src/env.ts`     | Runs against `SEQNO_E2E_BASE_URL` if set; otherwise builds and previews `apps/web` on port 4173.                                    |
| `design/`        | `pnpm design [scenes] [--app] [--theme]` shoots each scene in both apps and both themes into `design-out/compare.html`.             |
| `FEATURE_MAP.md` | Every user-facing feature, how to reach it, and the flow that covers it.                                                            |

- `pnpm design` shoots seqno at `SEQNO_E2E_BASE_URL` (a running preview) and Logseq at test.logseq.com (2.x) and demo.logseq.com (classic).
- `flows/screens.e2e.ts` refreshes `docs/screenshots/` when `SEQNO_SCREENS=1` is set; otherwise it is skipped.
- Flow files end in `.e2e.ts` so the root Vitest run doesn't pick them up.

## Tests

Playwright uses the installed Google Chrome (`channel: "chrome"`).

```sh
pnpm --filter @seqno/e2e test
```

## Known gaps

- The page-error guard sees main-thread errors only. An error thrown inside the core worker fails a test only if it reaches the page.
- `test` quiets the demo graphs' tips by default; `test.use({ hints: true })` turns them on. `openDemo(page, path, graph)` picks a demo graph in the first-visit chooser.
