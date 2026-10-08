---
name: verify-web
description: Launch the seqno web app in headless Chrome and check a user-facing feature with Playwright flows and screenshots. Use when asked to verify, QA, demo or screenshot something in apps/web or features/*, or before calling UI work done.
---

# Verify a seqno web feature

Headless only. Never open a visible browser, the Playwright HTML report or the trace viewer: each one opens a window on a machine someone may be using.

## 1. Find the flow

Look the feature up in `tools/e2e/FEATURE_MAP.md`. The Flow column names the file and test. If it says `planned`, go to step 4 and write it.

## 2. Run it

```sh
pnpm --filter @seqno/e2e test flows/journal.e2e.ts -g "reload keeps text"
```

With no `SEQNO_E2E_BASE_URL`, Playwright builds `apps/web`, serves it with `vite preview` on port 4173, runs the flows in headless Chrome and stops the server. If 4173 is taken, the run fails on purpose rather than test another worktree's build. Then run your own server on a free port and point the flows at it:

```sh
pnpm --filter @seqno/web dev --port 5199 --strictPort         # background it
SEQNO_E2E_BASE_URL=http://localhost:5199 pnpm --filter @seqno/e2e test flows/journal.e2e.ts
```

The dev server is quicker while iterating. The built app (the default) is what CI runs, so check with it before you report. Stop any server you started.

## 3. Look at the result

Every test saves its final screen to `tools/e2e/test-results/<file>-<test>/test-finished-1.png`. Read the PNG and check it shows what the feature should show, not only that the test went green.

Mid-flow pictures and text views go in the test while you work:

```ts
test("indent a block", async ({ page, seqno }, testInfo) => {
  // ...steps...
  await page.screenshot({ path: testInfo.outputPath("after-tab.png") })
  console.log(await seqno.today.getByRole("tree").ariaSnapshot())
})
```

The ARIA snapshot prints the block tree as indented text, which is the quickest way to check nesting, order and collapsed state. When a test fails, its folder also holds `error-context.md` (the page's ARIA snapshot at the failure) and `trace.zip`. Read those; don't open the trace viewer.

For a quick look with no flow at all, with a server running:

```sh
pnpm --filter @seqno/e2e exec playwright screenshot --channel chrome --full-page http://localhost:5199 /tmp/seqno.png
```

## 4. No flow yet: write one

Add the test to the file the map names, then set its Status in `FEATURE_MAP.md`. A flow you write to verify something is the feature's regression test from then on, so write it to keep.

```ts
import { expect, test } from "../src/test.ts"

test("indent a block", async ({ page, seqno }) => {
  await page.goto("/")
  await seqno.today.getByRole("treeitem").first().click()
  await page.keyboard.type("parent")
  await page.keyboard.press("Enter")
  await page.keyboard.type("child")
  await page.keyboard.press("Tab")
  const child = seqno.today.getByRole("treeitem", { name: "child", exact: true })
  await expect(child).toHaveAttribute("aria-level", "2")
})
```

- Import `test` and `expect` from `src/test.ts`. Its `page` fails the test on any uncaught page error, and `seqno` holds the shared locators.
- Find things by role. The "How flows find things" table in the map lists the markup the UI provides; if the UI changed, fix the locator in `src/test.ts`, not in each flow.
- Assert the exact value a user would see (`toHaveText("child")`, `toHaveAttribute("aria-level", "2")`). An `isVisible` check alone proves little.
- One behaviour per test, named after what the user does.
- Each test starts in a fresh browser context, so OPFS is empty and the app starts a new graph. To start from data, call `loadGraphFolder(page, fixtureGraph("<name>"))` from `src/opfs.ts` before `page.goto`; the app's folder picker then returns that fixture.
- Name flow files `*.e2e.ts`. The root `vitest run` would pick up `*.test.ts` and `*.spec.ts`.

## 5. Report

Say which flows you ran and whether they passed, list the screenshots you looked at with their paths, and describe anything on screen that looked wrong even when the test passed.
