import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { opfsFile } from "../src/opfs.ts"
import { serveMarketplace, settingsSaved } from "../src/plugins.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const runGit = async (page: Page, command: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+Digit1")

  const input = page
    .getByRole("dialog", { name: "Run git command" })
    .getByRole("textbox", { name: "Input command" })

  await input.fill(command)
  await input.press("Enter")
  await expect(page.getByRole("status")).toContainText(`${command.slice(4)} was executed`)
  await input.press("Escape")
  await expect
    .poll(async () => await page.evaluate(() => document.activeElement === document.body))
    .toBe(true)
}

const setIdentity = async (page: Page) => {
  await runGit(page, "git config --global user.name Bassim")
  await runGit(page, "git config --global user.email bassim@example.com")
}

const openHistory = async (page: Page) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "View page history" }).click()

  return page.getByRole("dialog", { name: "View page history" })
}

const tomatoesFile = async (page: Page) =>
  (await opfsFile(page, ["graphs", "demo"], "pages/Tomatoes.md"))?.text ?? ""

const openTomatoes = async (page: Page) => {
  await openDemo(page, "/page/tomatoes")
  await expect(page.getByRole("heading", { level: 1, name: "Tomatoes" })).toBeVisible()
}

test("Create git commit with message commits the graph's files, View page history shows each version of the page, and Revert brings an old one back", async ({
  page,
}) => {
  await openTomatoes(page)
  await expect
    .poll(async () => (await opfsFile(page, ["graphs", "demo"], "logseq/config.edn")) !== null)
    .toBe(true)
  await page.keyboard.press("ControlOrMeta+g")
  await page.keyboard.press("c")
  const commit = page.getByRole("dialog", { name: "Commit" })
  await expect(commit.getByRole("heading", { name: "You have uncommitted changes:" })).toBeVisible()
  await expect(commit.locator("pre")).toContainText("?? pages/")
  await commit.getByRole("textbox", { name: "Your commit message:" }).fill("First look")
  await commit.getByRole("textbox", { name: "Your commit message:" }).press("Enter")

  const identity = page.getByRole("dialog", { name: "Git username and email" })
  await identity.getByRole("textbox", { name: "Your username:" }).fill("Bassim")
  await identity.getByRole("textbox", { name: "Your email address:" }).fill("bassim@example.com")
  await identity.getByRole("button", { name: "Submit" }).click()
  await expect(page.getByRole("status")).toContainText("git config successfully!")

  await page.keyboard.press("ControlOrMeta+g")
  await page.keyboard.press("c")
  await commit.getByRole("textbox", { name: "Your commit message:" }).fill("First look")
  await commit.getByRole("textbox", { name: "Your commit message:" }).press("Enter")
  await expect(commit).toBeHidden()

  const history = await openHistory(page)
  await expect(history).toContainText("File history - pages/Tomatoes.md")
  await expect(history.getByRole("link")).toHaveCount(1)
  await expect(history).toContainText("First look")
  await expect(history.locator("pre")).toContainText("- Three kinds this year:")
  await page.keyboard.press("Escape")

  await page.keyboard.press("ControlOrMeta+g")
  await page.keyboard.press("c")
  await expect(commit.getByRole("heading", { name: "No changes to commit!" })).toBeVisible()
  await commit.getByRole("button", { name: "Close" }).click()

  await page.getByText("Three kinds this year:").click()
  await page.keyboard.press("End")
  await page.keyboard.type(" and a fourth")
  await page.keyboard.press("Escape")
  await expect
    .poll(async () => await tomatoesFile(page))
    .toContain("- Three kinds this year: and a fourth\n")
  await page.keyboard.press("ControlOrMeta+g")
  await page.keyboard.press("c")
  await expect(commit.locator("pre")).toHaveText(" M pages/Tomatoes.md")
  await commit.getByRole("textbox", { name: "Your commit message:" }).fill("A fourth kind")
  await commit.getByRole("textbox", { name: "Your commit message:" }).press("Enter")
  await expect(commit).toBeHidden()

  await openHistory(page)
  await expect(history.getByRole("link")).toHaveCount(2)
  await expect(history.locator(".git-history-commit").first()).toContainText("A fourth kind")
  await expect(history.locator("pre")).toContainText("- Three kinds this year: and a fourth")
  await history.getByRole("link").nth(1).click()
  await expect(history.locator("pre")).not.toContainText("and a fourth")
  await history.getByRole("button", { name: "Revert" }).click()
  await page.keyboard.press("Escape")
  await expect.poll(async () => await tomatoesFile(page)).not.toContain("and a fourth")
  await expect(
    page.getByRole("treeitem", { name: "Zoom into block Three kinds this year:", exact: true }),
  ).toBeVisible({ timeout: 10_000 })

  await page.keyboard.press("ControlOrMeta+g")
  await page.keyboard.press("c")
  await expect(commit.locator("pre")).toHaveText(" M pages/Tomatoes.md")
})

test("Git auto commit commits on its interval with Logseq's message, once Settings turns it on", async ({
  page,
}) => {
  await openTomatoes(page)
  await setIdentity(page)
  await page.keyboard.press("t")
  await page.keyboard.press("s")
  const settings = page.getByRole("dialog", { name: "Settings" })
  await settings.getByRole("tab", { name: "Version control" }).click()
  const seconds = settings.getByRole("textbox", { name: "Git auto commit seconds" })
  await expect(seconds).toHaveValue("60")
  await seconds.fill("1")
  await seconds.blur()
  await settings.getByRole("switch", { name: "Enable Git auto commit" }).click()
  await expect(settings.getByRole("switch", { name: "Enable Git auto commit" })).toHaveAttribute(
    "aria-checked",
    "true",
  )
  await page.keyboard.press("Escape")

  const history = await openHistory(page)
  await expect(history).toContainText("Auto saved by Logseq")
  await page.keyboard.press("Escape")
  await page.reload()
  await page.keyboard.press("t")
  await page.keyboard.press("s")
  await settings.getByRole("tab", { name: "Version control" }).click()
  await expect(settings.getByRole("switch", { name: "Enable Git auto commit" })).toHaveAttribute(
    "aria-checked",
    "true",
  )
  await expect(seconds).toHaveValue("1")
})

test("GitSeq syncs through Logseq.Git: it commits the graph and reports that no remote is set up", async ({
  page,
  context,
}) => {
  await serveMarketplace(context)
  await openTomatoes(page)
  await setIdentity(page)
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()
  const plugins = page.getByRole("dialog", { name: "Plugins" })
  await plugins.getByRole("tab", { name: "Marketplace" }).click()
  const card = plugins.getByRole("listitem", { name: "GitSeq" })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")

  await expect(page.getByRole("status")).toContainText(
    "No upstream branch configured. In a terminal, run: git push -u origin main",
  )
  await expect(page.locator('[title="Sync error — check logs"]')).toBeAttached()
  await settingsSaved(page)
  await page.reload()
  await expect(page.locator('[title="Sync error — check logs"]')).toBeAttached()
  const plugin = page.frame({ url: /gitseq/u })
  const log = await plugin?.evaluate(`logseq.Git.execCommand(["log", "--format=%an %s"])`)
  expect(log).toEqual({
    stdout: expect.stringMatching(/^Bassim sync: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\n$/u),
    stderr: "",
    exitCode: 0,
  })
  expect(await plugin?.evaluate(`logseq.Git.execCommand(["status", "--porcelain"])`)).toEqual({
    stdout: "",
    stderr: "",
    exitCode: 0,
  })

  const seqnoFiles =
    "updates/\nsnapshots/\nseen/\nedit-log/\nstarter-version\n*.crswap\n*.seqno-tmp\n"

  expect(await plugin?.evaluate(`logseq.Git.loadIgnoreFile()`)).toBe(seqnoFiles)
  await plugin?.evaluate(`logseq.Git.saveIgnoreFile(${JSON.stringify(`${seqnoFiles}*.bak\n`)})`)
  expect(await plugin?.evaluate(`logseq.Git.loadIgnoreFile()`)).toBe(`${seqnoFiles}*.bak\n`)

  const history = await openHistory(page)
  await expect(history).toContainText(/sync: \d{4}-/u)
})
