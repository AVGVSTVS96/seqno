import type { Locator, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { serveMarketplace, settingsSaved } from "../src/plugins.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

test.beforeEach(async ({ context }) => {
  await serveMarketplace(context)
})

const openPlugins = async (page: Page) => {
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Plugins" }).click()

  return page.getByRole("dialog", { name: "Plugins" })
}

const install = async (page: Page, name: string) => {
  const dialog = await openPlugins(page)
  await dialog.getByRole("tab", { name: "Marketplace" }).click()
  const card = dialog.getByRole("listitem", { name })
  await card.getByRole("button", { name: "Install" }).click()
  await expect(card.getByRole("button", { name: "Installed" })).toBeDisabled()
  await page.keyboard.press("Escape")
}

test("Word count shows how many words are selected in a block, next to the selection", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "logseq-wordcount-plugin")
  const dialog = await openPlugins(page)
  await dialog.getByRole("button", { name: "logseq-wordcount-plugin settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  const count = settings.getByRole("switch", { name: "Count Highlighted Text" })
  await count.click()
  await expect(count).toHaveAttribute("aria-checked", "true")
  await page.reload()
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()

  const [start, end] = await seqno.editor.evaluate((editor) => {
    const line = editor.querySelector(".cm-line")?.firstChild ?? editor

    const at = (offset: number) => {
      const range = document.createRange()
      range.setStart(line, offset)
      range.setEnd(line, offset + 1)
      const rect = range.getBoundingClientRect()

      return { x: rect.left + 1, y: rect.top + rect.height / 2 }
    }

    return [at(0), at("Rain all morning".length - 1)]
  })

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const point = { x: Math.round(end.x + 6), y: Math.round(end.y) }
  await page.mouse.move(point.x, point.y, { steps: 5 })
  await page.mouse.up()
  const float = page.locator("#logseq-wordcount-plugin--logseq-wordcount-plugin-countselection")
  await expect(float).toHaveText("Words: 3")
  const container = float.locator("xpath=ancestor::*[contains(@class, 'lsp-ui-float-container')]")

  const corner = async () => {
    const box = await container.boundingBox()

    return box === null ? null : [Math.round(box.x), Math.round(box.y)]
  }

  expect(await corner()).toEqual([point.x, point.y])
  await expect(container).toHaveAttribute("draggable", "true")
  const handle = container.locator(".draggable-handle")
  const grip = await handle.boundingBox()

  if (grip !== null) {
    await page.mouse.move(grip.x + 20, grip.y + 10)
    await page.mouse.down()
    await page.mouse.move(grip.x + 60, grip.y + 40, { steps: 5 })
    await page.mouse.up()
  }

  expect(await corner()).toEqual([point.x + 40, point.y + 30])
  await container.getByRole("button", { name: "Close" }).click()
  await expect(float).toHaveCount(0)
  await page.mouse.click(10, 10)
  await expect(page.locator("#logseq-wordcount-plugin_lsp_main")).not.toHaveClass(/visible/u)
})

test("Quick Capture adds a note to today's journal, found with a Datalog query on :today", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Quick Capture")
  await page.locator('[data-on-click="handleShowQuickCapture"]').click()
  const capture = page.frameLocator("#logseq-quick-capture_iframe")
  await capture.getByRole("textbox").fill("Order more seed potatoes")
  await capture.getByRole("textbox").press("Control+Enter")
  await expect(page.locator("#logseq-quick-capture_lsp_main")).not.toHaveClass(/visible/u)
  await expect(seqno.today.getByRole("treeitem").last()).toHaveText(/Order more seed potatoes/u)
})

test("Quick Capture's default block puts notes under that block, matched by its text", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Quick Capture")
  const dialog = await openPlugins(page)
  await dialog.getByRole("button", { name: "Quick Capture settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  await settings
    .getByRole("textbox", { name: "Default Block" })
    .fill("Welcome to the seqno demo graph")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.locator('[data-on-click="handleShowQuickCapture"]').click()
  const capture = page.frameLocator("#logseq-quick-capture_iframe")
  await capture.getByRole("textbox").fill("Sketch the new bed layout")
  await capture.getByRole("textbox").press("Control+Enter")
  const child = seqno.today.getByRole("treeitem", { level: 2 })
  await expect(child).toHaveText(/Sketch the new bed layout/u)
  await expect(child.locator("xpath=preceding-sibling::*[1]")).toHaveText(
    /Welcome to the seqno demo graph/u,
  )
})

const statsBlock = async (page: Page, today: Locator, blocks: number) => {
  await today.getByRole("treeitem").filter({ hasText: "Welcome to the seqno demo graph" }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("treeitem").getByRole("textbox")).toHaveText("")
  await page.keyboard.insertText("{{renderer :logstats, text}}")
  await page.keyboard.press("Escape")
  const all = today.getByRole("treeitem").filter({ hasText: "Finished tasks (DONE)" })
  await expect(all).toHaveCount(blocks)
  const text = (await all.first().textContent()) ?? ""
  const count = (label: string) => Number(new RegExp(`${label}: (\\d+)`, "u").exec(text)?.[1])

  return {
    tasks: count("Tasks"),
    done: count("Finished tasks \\(DONE\\)"),
    refs: count("Block References"),
  }
}

test("Log-Stats counts the graph's tasks with Datalog not, contains? and re-find, and follows edits", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Log-Stats")
  const before = await statsBlock(page, seqno.today, 1)
  expect(before.tasks).toBeGreaterThan(0)
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  await page.keyboard.press("End")
  const editor = page.getByRole("treeitem").getByRole("textbox")
  await page.keyboard.press("Enter")
  await expect(editor).toHaveText("")
  await page.keyboard.type("DONE turn the compost")
  await page.keyboard.press("Enter")
  await expect(editor).toHaveText("")
  await page.keyboard.type("TODO buy twine")
  await expect(editor).toHaveText("TODO buy twine")
  await page.keyboard.press("Escape")
  const after = await statsBlock(page, seqno.today, 2)
  expect(after).toEqual({ tasks: before.tasks + 1, done: before.done + 1, refs: before.refs })
})

const annotation = {
  id: "seed-1",
  uri: "https://example.org/seed-saving",
  created: "2026-10-01T10:00:00.000000+00:00",
  updated: "2026-10-01T10:00:00.000000+00:00",
  text: "Dry the seeds for a week",
  tags: [],
  document: { title: ["Seed saving guide"] },
  target: [{ source: "https://example.org/seed-saving", selector: [] }],
  links: {},
  user: "acct:gardener@hypothes.is",
}

test("Hypothesis keeps fetched notes in its file storage, so they're there after a reload", async ({
  page,
  seqno,
}) => {
  let online = true
  await page
    .context()
    .route(/^https:\/\/api\.hypothes\.is\/api\/search/u, async (route, request) => {
      if (!online) {
        await route.abort()

        return
      }

      await route.fulfill({
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
        json: {
          rows: new URL(request.url()).searchParams.has("search_after") ? [] : [annotation],
        },
      })
    })
  await seqno.openDemoGraph()
  await install(page, "Hypothesis")
  const dialog = await openPlugins(page)
  await dialog.getByRole("button", { name: "Hypothesis settings" }).click()
  const settings = page.getByRole("dialog", { name: "Plugin settings" })
  await settings.getByRole("textbox", { name: "API Token" }).fill("token")
  await settings.getByRole("textbox", { name: "User account" }).fill("gardener")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  const hypothesis = page.frameLocator("#logseq-hypothesis_iframe")
  await page.locator('[title="Hypothes.is"]').click()
  await hypothesis.getByRole("button", { name: "Fetch latest notes" }).click()
  await expect(hypothesis.getByRole("button", { name: "Fetch latest notes" })).toBeEnabled()
  await hypothesis.locator("#uri").click()
  await expect(hypothesis.getByRole("option", { name: /Seed saving guide/u })).toBeVisible()
  online = false
  await page.reload()
  await page.locator('[title="Hypothes.is"]').click()
  await hypothesis.locator("#uri").click()
  await expect(hypothesis.getByRole("option", { name: /Seed saving guide/u })).toBeVisible()
})

test("a block a plugin inserts with a customUUID keeps that uuid, so ((refs)) and getBlock reach it", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Quick Capture")
  await settingsSaved(page)
  await page.reload()
  const uuid = "6650a1b2-1111-4000-8000-00000000abcd"
  await expect(page.locator('[data-on-click="handleShowQuickCapture"]')).toBeVisible()
  const plugin = page.frame({ url: /logseq-quick-capture/u })

  const inserted = await plugin?.evaluate(`(async () => {
    const page = await logseq.Editor.getCurrentPage() ?? (await logseq.Editor.getAllPages()).find((one) => one["journal?"])
    const anchor = (await logseq.Editor.getPageBlocksTree(page.name)).at(-1)
    const block = await logseq.Editor.insertBlock(anchor.uuid, "Seed order placed", { sibling: true, customUUID: "${uuid}" })
    const again = await logseq.Editor.insertBlock(anchor.uuid, "twice", { sibling: true, customUUID: "${uuid}" }).catch((error) => error.message ?? String(error))
    return [block.uuid, (await logseq.Editor.getBlock("${uuid}")).content, again]
  })()`)

  expect(inserted).toEqual([
    uuid,
    `Seed order placed\nid:: ${uuid}`,
    `Custom block UUID already exists (${uuid}).`,
  ])
  await seqno.today.getByRole("treeitem").filter({ hasText: "Rain all morning" }).click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(seqno.editor).toHaveText("")
  await page.keyboard.insertText(`See ((${uuid}))`)
  await page.keyboard.press("Escape")
  await expect(seqno.today.getByRole("treeitem", { name: /^Zoom into block See /u })).toHaveText(
    /See Seed order placed/u,
  )
})

const codeBlock = async (page: Page, today: Locator, after: string, code: string) => {
  await today.getByRole("treeitem").filter({ hasText: after }).first().click()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("treeitem").getByRole("textbox")).toHaveText("")
  await page.keyboard.insertText(code)
  await page.keyboard.press("Escape")
}

test("Fenced code plus draws htmlmixed and mermaid code blocks with Logseq's React and loadScripts, with buttons to show the code and edit the block", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Fenced code plus")
  await codeBlock(
    page,
    seqno.today,
    "Welcome to the seqno demo graph",
    '```htmlmixed\n<b class="grown">Tomatoes</b>\n```',
  )

  const html = page
    .locator(".ui-fenced-code-wrap")
    .filter({ has: page.locator(".fcp-html-container") })

  await expect(html.locator(".fcp-html-container b.grown")).toHaveText("Tomatoes")
  await expect(html.locator(".ui-fenced-code-editor")).toBeHidden()
  await html.locator(".ui-fenced-code-result").hover()
  await html.getByRole("button", { name: "Show code" }).click()
  await expect(html.locator(".ui-fenced-code-editor")).toHaveText(/<b class="grown">Tomatoes<\/b>/u)
  await expect(html.getByRole("button", { name: "Show code" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await html.getByRole("button", { name: "Show code" }).click()
  await expect(html.locator(".ui-fenced-code-editor")).toBeHidden()
  await html.locator(".fcp-html-container").click()
  await expect(page.getByRole("treeitem").getByRole("textbox")).toHaveCount(0)
  await html.locator(".ui-fenced-code-result").hover()
  await html.getByRole("button", { name: "Edit block" }).click()
  await expect(page.getByRole("treeitem").getByRole("textbox")).toHaveText(/```htmlmixed/u)
  await page.keyboard.press("Escape")

  await codeBlock(
    page,
    seqno.today,
    "Welcome to the seqno demo graph",
    "```mermaid\ngraph TD\n  Seed --> Sprout\n```",
  )
  const diagram = page.locator(".ui-fenced-code-result .mermaid > svg")
  await expect(diagram).toContainText("Sprout")
  await expect(page.locator('script[data-ref="logseq-fenced-code-plus"]')).toHaveAttribute(
    "src",
    /\/lsp\/xyhp915\/logseq-fenced-code-plus\/0\.0\.11\/vendors\/mermaid\.min\.js$/u,
  )
})

test("Random Note's Let's go opens a random page that isn't a journal, from its Datalog query", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await install(page, "Random Note")
  await page.keyboard.press("ControlOrMeta+Shift+KeyP")
  const palette = page.getByRole("dialog", { name: "Search" })
  await palette.getByRole("searchbox", { name: "Search" }).fill("let's go")
  await palette.getByRole("option", { name: /Random note => Let's go/u }).click()
  await expect(page).toHaveURL(/\/page\/[^/]+$/u)
  const title = page.getByRole("heading", { level: 1 }).first()
  await expect(title).toBeVisible()
  await expect(title).not.toHaveText(/^[A-Z][a-z]{2} \d{1,2}(st|nd|rd|th), \d{4}$/u)
})
