# @seqno/e2e: phase 1 results

## Design harness

`design/` puts seqno next to Logseq, scene by scene, in light and dark, at 1440×900. It writes `<scene>-<theme>.logseq.png`, `<scene>-<theme>.seqno.png` and one `compare.html` with every pair side by side into `design-out/` (gitignored). The measured values behind the comparison are in `docs/design/SPEC.md`.

```sh
# build and serve your own seqno first (your port, never 4173 or 4777-4799)
pnpm --filter @seqno/web build
pnpm --filter @seqno/web preview --port 4181 --strictPort &

cd tools/e2e
SEQNO_E2E_BASE_URL=http://localhost:4181/ pnpm design                    # every scene, both apps, both themes
SEQNO_E2E_BASE_URL=http://localhost:4181/ pnpm design slash search       # only these scenes
SEQNO_E2E_BASE_URL=http://localhost:4181/ pnpm design --app seqno        # only seqno (seconds; Logseq shots stay)
pnpm design --app logseq --theme dark journals                           # only the reference, one theme
```

Wrap each in `systemd-run --user --scope --slice=seqno.slice -p MemoryMax=1500M -p MemorySwapMax=0 -E SEQNO_E2E_BASE_URL=...` on the shared box. If `/tmp` is full, add `-E TMPDIR=<a folder on /home>`: Chrome profiles and the temporary showcase copy go there.

Open `design-out/compare.html`. A tick box shows difference images (black where the pixels match). Each pair lists what failed, for example `missing: slash menu (role listbox)`: seqno scenes record a missing step and still take the screenshot, so the shot shows what is there today.

| Scene                    | Reference      | What it shows                                                |
| ------------------------ | -------------- | ------------------------------------------------------------ |
| `journals`               | Logseq 2.x     | journals home with three days                                |
| `page`                   | Logseq 2.x     | Garden Plan with its linked references                       |
| `showcase-top`           | Logseq classic | Showcase page, top: properties, headings, text styles, lists |
| `showcase-lower`         | Logseq classic | Showcase page from Properties down: code blocks, tasks       |
| `editing`                | Logseq 2.x     | a journal block in edit mode, caret at the end               |
| `autocomplete`           | Logseq 2.x     | `[[Gar` typed, page autocomplete open                        |
| `slash`                  | Logseq 2.x     | `/` typed, slash menu open                                   |
| `search`                 | Logseq 2.x     | Mod+K palette with "greenhouse" typed                        |
| `right-sidebar`          | Logseq 2.x     | Garden Plan shift-clicked into the right sidebar             |
| `left-sidebar-collapsed` | Logseq 2.x     | journals with the left sidebar closed                        |
| `all-pages`              | Logseq 2.x     | all pages (`g a`)                                            |

How it works:

- **seqno** (`design/seqno.ts`): every scene gets a fresh browser context. The showcase graph (`fixtures/graphs/showcase`, journals shifted so the newest is today) is seeded into the demo graph's OPFS folder with `seedOpfs`, and `seqno.theme` / `seqno.leftSidebar` go into localStorage before the app loads. Locators are role based (`treeitem`, `listbox`, `dialog`, `complementary "Right sidebar"`), so a scene starts passing as soon as the UI exposes those roles.
- **Logseq** (`design/logseq.ts`): one context per reference app. The harness pastes the showcase markdown into the browser-only demo graph (2.x: today's journal, two earlier journals, Garden Plan and Reading List; classic: a new "Showcase" page, with the SVG asset served by a route). It never signs in or opens a folder. Theme, sidebars and pages switch through Logseq's own shortcuts (`t t`, `t l`, `t r`, `g a`); every edit a scene makes is restored afterwards.
- `scrollToText` scrolls the target row into view, then scrolls its nearest scrolling ancestor back by the offset (the main column in seqno, `#main-content-container` in Logseq), so the lower showcase frames line up.
- Before a shot the pointer moves to the corner and the harness waits for fonts and finite animations to finish (`settled`), so pairs are stable run to run.
- `design/scenes.ts` holds both sides of each scene. Adding a scene is one entry there.

Known quirks of the references:

- Logseq 2.x renders a pasted `[[projects/Greenhouse]]` as an empty `[[]]`, and pasted `TODO`/`DOING` as plain text (2.x keeps task state in properties). Compare markers against the classic scenes.
- The classic scenes show classic's chrome (its own left sidebar, an "Add a graph" button); only their page content is the reference. Chrome comes from 2.x.
- Logseq 2.x opens with the left sidebar closed at 1440px; every scene sets the sidebar explicitly.

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
