import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { appAvailable } from "../src/env.ts"
import { loadGraphFolder } from "../src/opfs.ts"
import { expect, saved, test } from "../src/test.ts"
import { board, newBoard, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

test.use({ onboarded: false })

const onboardingFile =
  "https://raw.githubusercontent.com/logseq/logseq/0.10.9/resources/whiteboard/onboarding.edn"

test("the first board you create is filled with Logseq's own onboarding board, once", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.route(onboardingFile, async (route) => {
    await expect(page.getByText("Loading onboarding whiteboard ...")).toBeVisible()
    await route.continue()
  })
  await newBoard(page)
  const counts = { text: 32, line: 19, image: 19, box: 6, highlighter: 1, youtube: 1, iframe: 1 }
  for (const [type, count] of Object.entries(counts)) {
    await expect(shapes(page, type)).toHaveCount(count)
  }
  await expect(page.getByText("Loading onboarding whiteboard ...")).toHaveCount(0)
  await expect(
    shapes(page, "text").locator(".wb-text").filter({ hasText: "Welcome to" }),
  ).toBeVisible()
  await expect(
    shapes(page, "text").locator(".wb-text").filter({ hasText: "Whiteboards!" }),
  ).toBeVisible()
  await expect(shapes(page, "image").first().locator("img")).toHaveAttribute("src", /^data:image/)
  await expect(shapes(page, "iframe").locator("iframe")).toHaveAttribute(
    "src",
    "https://logseq.com/",
  )

  await saved(page, 30_000)
  await page.reload()
  await expect(shapes(page, "text")).toHaveCount(32)

  await page.keyboard.press("g")
  await page.keyboard.press("w")
  await page.getByRole("button", { name: "New whiteboard" }).click()
  await expect(page.getByRole("textbox", { name: "Whiteboard title" })).toHaveAttribute(
    "placeholder",
    "Untitled",
  )
  await expect(board(page).locator(".wb-shape")).toHaveCount(0)
})

test("when the onboarding file can't be fetched, the board opens empty", async ({ page }) => {
  await page.route(onboardingFile, (route) => route.abort())
  await newBoard(page)
  await expect(page.getByText("Loading onboarding whiteboard ...")).toHaveCount(0)
  await expect(board(page).locator(".wb-shape")).toHaveCount(0)
})

test("the first click on Whiteboards in the sidebar welcomes you, and Start whiteboarding runs Logseq's two-step tour", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const graph = testInfo.outputPath("my-notes")
  await mkdir(join(graph, "pages"), { recursive: true })
  await writeFile(join(graph, "pages", "ideas.md"), "- sketch the [[Garden]]")
  await Promise.all(
    Array.from({ length: 1500 }, (_, i) =>
      writeFile(join(graph, "pages", `note ${i}.md`), `- planted [[Garden]] bed ${i}`),
    ),
  )
  await loadGraphFolder(page, graph)
  await page.goto("/")
  await page.getByRole("button", { name: "Open a folder" }).click()
  await page.getByRole("button", { name: "Toggle left sidebar" }).click({ timeout: 30_000 })
  const nav = page.getByRole("navigation", { name: "Navigations" })
  await nav.getByRole("link", { name: "Whiteboards" }).click()
  await expect(page).toHaveURL(/\/whiteboards$/)
  const welcome = page.getByRole("dialog", { name: "A new canvas for your thoughts." })
  await expect(welcome).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(welcome).toBeVisible()
  await welcome.getByRole("button", { name: "Start whiteboarding" }).click()
  await expect(welcome).toHaveCount(0)

  const home = page.getByRole("dialog", { name: "🖼 Home for your whiteboards" })
  await expect(home).toContainText("STEP 1")
  const item = await nav.getByRole("link", { name: "Whiteboards" }).boundingBox()
  const step = await home.boundingBox()
  expect(step?.x).toBeGreaterThanOrEqual((item?.x ?? 0) + (item?.width ?? 0))
  await home.getByRole("button", { name: "Next" }).click()

  const create = page.getByRole("dialog", { name: "🆕️ Create new whiteboard" })
  await expect(create).toBeVisible()
  await expect(create).toContainText("STEP 2")
  const card = await page.getByRole("button", { name: "New whiteboard" }).boundingBox()
  expect((await create.boundingBox())?.y).toBeGreaterThanOrEqual(
    (card?.y ?? 0) + (card?.height ?? 0),
  )
  await create.getByRole("button", { name: "Back" }).click()
  await expect(home).toBeVisible()
  await page.keyboard.press("ArrowRight")
  await create.getByRole("button", { name: "Finish" }).click()
  await expect(create).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Skip Quick Tour" })).toHaveCount(0)

  await nav.getByRole("link", { name: "Journals" }).click()
  await nav.getByRole("link", { name: "Whiteboards" }).click()
  await expect(page).toHaveURL(/\/whiteboards$/)
  await expect(welcome).toHaveCount(0)
})
