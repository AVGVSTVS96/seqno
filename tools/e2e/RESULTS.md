# @seqno/e2e: phase 1 results

## What works

| Piece                                                                                                                                   | Where                                | State                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| Playwright harness: headless Chrome, base URL from `SEQNO_E2E_BASE_URL`, builds and serves `apps/web` itself when the variable is unset | `playwright.config.ts`, `src/env.ts` | works                                    |
| Fixture loading into OPFS: `seedOpfs`, `opfsFiles`, `loadGraphFolder`, `fixtureGraph`                                                   | `src/opfs.ts`                        | works, self-tested                       |
| Shared `test`: fails any test whose page throws an uncaught error; `seqno` fixture holds the role-based locators                        | `src/test.ts`                        | works                                    |
| First flows: open app, journal visible, type in a block, reload keeps text                                                              | `flows/journal.e2e.ts`               | written, skipped until `apps/web` exists |
| Feature map, phases 1 and 2                                                                                                             | `FEATURE_MAP.md`                     | done                                     |
| Agent verify skill                                                                                                                      | `.claude/skills/verify-web/SKILL.md` | done                                     |
| CI workflow: `pnpm check` job and an e2e job, report uploaded on failure                                                                | `.github/workflows/ci.yml`           | written, not run (nothing pushed)        |

Last run: 3 passed, 4 skipped, 1.4 s.

```
✓ seedOpfs copies a vault folder into OPFS byte for byte
✓ loadGraphFolder hands the seeded folder to the folder picker
✓ journal titles follow Logseq's default MMM do, yyyy format
- open app / journal visible / type in a block / reload keeps text   (waits on apps/web)
```

The four journal flows also passed against a throwaway static page that follows the markup in "How flows find things" (`FEATURE_MAP.md`), so they are known to run. That page is not committed.

## How to run

```sh
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm --filter @seqno/e2e test
systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 pnpm --filter @seqno/e2e typecheck
```

Against a server that is already running: `SEQNO_E2E_BASE_URL=http://localhost:5199 pnpm --filter @seqno/e2e test`. Screenshots land in `tools/e2e/test-results/`.

## How it fits together

```
SEQNO_E2E_BASE_URL set?
  yes -> test that URL, start nothing
  no  -> apps/web exists? -> `pnpm --filter @seqno/web build && ... preview --port 4173 --strictPort`
                             (fails if 4173 is busy rather than test another worktree's build)

journal flows: test.skip unless apps/web exists or SEQNO_E2E_BASE_URL is set
```

**Seeding OPFS.** `seedOpfs` routes `/__seqno_e2e__/*` on the app's own origin: one blank page, plus one URL per file that Playwright serves straight from disk. The blank page fetches each file and writes it into OPFS. No app code runs while seeding, binary files never pass through JSON, and nothing depends on a server being up.

**Fixture graphs reach the app the way a user's folder does.** `loadGraphFolder` seeds the folder, then replaces `window.showDirectoryPicker` (init script) with one that returns that OPFS folder. OPFS handles share the File System Access interface, so "open a folder" and "import a Logseq graph" can run headless with no knowledge of how the app lays out its own storage.

## Decisions to look at

- **Chrome instead of Playwright's bundled Chromium** (`channel: "chrome"`). The app targets Chrome and Edge. Chrome stable is already installed on this machine and on GitHub's `ubuntu-24.04` runners, so nothing has to be downloaded. Switching to the bundled build is `channel: "chromium"` plus `playwright install chromium` in CI.
- **Flow files are `*.e2e.ts`.** The root `vitest run` picks up every `*.test.ts` and `*.spec.ts` in the workspace and would try to run Playwright files.
- **One worker.** It keeps Chrome's memory use predictable on a shared machine. The suite is small enough that it doesn't cost anything yet.
- **The CI check job runs `pnpm check` only**, because the scaffold's root `check` already ends in `pnpm test`. If `check` stops including tests, add a `pnpm test` step.
- **`effect` 4.0.1** is a dependency only to parse `SEQNO_E2E_BASE_URL` with `Schema.URLFromString`.
- **The phase 1 / phase 2 split in the feature map is inferred** from "phase 1 = foundation plus app skeleton": shell, journals, outliner, editor and local persistence are phase 1; references, search, queries, folders, import and sync are phase 2. Move rows if the plan says otherwise.

## What integration needs from other parts

- `apps/web`: scripts `dev`, `build` and `preview` (plain Vite); `<title>seqno</title>`; a fresh OPFS starts a new graph whose today's journal has one empty block.
- `apps/web`, `features/outliner`, `features/editor`: the markup in the map's "How flows find things" table. A page is an `<article>` labelled by its `<h1>`, a block is a `treeitem`, the editor is CodeMirror's `textbox`. If the UI settles on other markup, the locators live in `src/test.ts`.
- Root `.gitignore` must list `test-results/` and `playwright-report/`. The scaffold's version already does.

## Known gaps

- `fixtures/` doesn't exist on this branch, so no flow loads a real fixture yet. If the fixture graphs are Logseq markdown folders, they reach the app through the import flow (`loadGraphFolder`). Seeding the app's own graph storage directly needs the OPFS path `@seqno/vault` settles on; `seedOpfs(page, dir, thatPath)` then does it.
- The page-error guard sees main-thread errors only. Errors thrown inside the core worker don't fail a test unless they surface in the page.
- "Journal visible" works out today's title from the test machine's clock. A run that crosses midnight between test start and page load would fail once.
- The CI workflow hasn't run on GitHub. Action versions are the current majors (`checkout@v7`, `setup-node@v7`, `pnpm/action-setup@v6`, `upload-artifact@v7`).
