import { appAvailable } from "../src/env.ts"
import { pdfWithPages } from "../src/pdf.ts"
import { expect, saved, test } from "../src/test.ts"
import { board, fireFiles, firePaste, newBoard, shapes } from "../src/whiteboard.ts"

test.skip(!appAvailable, "waits on apps/web")

const bar = (page: Parameters<typeof board>[0]) =>
  page.getByRole("toolbar", { name: "Shape style" })

test("a pasted YouTube link becomes a YouTube embed you play after a double-click, with its URL in the context bar", async ({
  page,
}) => {
  await newBoard(page)
  await page.mouse.move(200, 150)
  await firePaste(page, [200, 150], {
    text: "https://www.youtube.com/watch?v=oBtKHwFBn0k&list=PLNnZ7rjaL84JjFpgDxRlAOKRa9ie25gtp",
  })
  const video = shapes(page, "youtube")
  await expect(video).toHaveCSS("width", "853px")
  await expect(video).toHaveCSS("height", "480px")
  await expect(video.locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube.com/embed/oBtKHwFBn0k",
  )
  await expect(video.locator("iframe")).toHaveCSS("pointer-events", "none")
  await expect(bar(page).getByRole("textbox", { name: "YouTube url" })).toHaveValue(
    "https://www.youtube.com/watch?v=oBtKHwFBn0k&list=PLNnZ7rjaL84JjFpgDxRlAOKRa9ie25gtp",
  )
  await page.keyboard.press("Escape")
  await expect(bar(page)).toHaveCount(0)
  await page.mouse.dblclick(600, 300)
  await expect(video).toHaveAttribute("data-active", "true")
  await expect(video.locator("iframe")).toHaveCSS("pointer-events", "auto")
  await page.keyboard.press("Escape")
  await expect(video).toHaveAttribute("data-active", "false")

  await saved(page)
  await page.reload()
  await expect(shapes(page, "youtube").locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube.com/embed/oBtKHwFBn0k",
  )
})

test("tweet links embed the tweet, other links become a sandboxed website the Reload button reloads", async ({
  page,
}) => {
  await newBoard(page)
  await page.mouse.move(150, 120)
  await firePaste(page, [150, 120], {
    text: "https://twitter.com/logseq/status/1600000000000000000",
  })
  await expect(shapes(page, "tweet").locator("iframe")).toHaveAttribute(
    "src",
    /^https:\/\/platform\.twitter\.com\/embed\/Tweet\.html\?dnt=true&id=1600000000000000000/u,
  )
  await page.mouse.click(1100, 650)
  await page.mouse.move(150, 400)
  await firePaste(page, [150, 400], { text: "https://example.com/" })
  const site = shapes(page, "iframe")
  await expect(site.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-presentation",
  )
  await site.locator("iframe").evaluate((node) => {
    node.setAttribute("data-mark", "old")
  })
  await bar(page).getByRole("button", { name: "Reload" }).click()
  await expect(site.locator("iframe")).not.toHaveAttribute("data-mark", "old")
  await expect(bar(page).getByRole("textbox", { name: "Website url" })).toHaveValue(
    "https://example.com/",
  )
})

test("pasted HTML becomes an HTML shape without its scripts, and pasted iframe code becomes one too", async ({
  page,
}) => {
  await newBoard(page)
  await page.mouse.move(200, 200)
  await firePaste(page, [200, 200], {
    text: "Hello board",
    html: '<p><b>Hello</b> board</p><script>window.ran = true</script><img src="x" onerror="window.ran = true">',
  })
  const html = shapes(page, "html")
  await expect(html.locator("b")).toHaveText("Hello")
  await expect(html.locator("script")).toHaveCount(0)
  await expect(html.locator("img")).not.toHaveAttribute("onerror")
  expect(await page.evaluate(() => "ran" in window)).toBe(false)
  await expect(bar(page).getByRole("button", { name: "Auto resize" })).toBeVisible()

  await page.mouse.click(1100, 650)
  await page.mouse.move(200, 450)
  await firePaste(page, [200, 450], {
    text: '<iframe src="https://example.com/" width="320" height="180"></iframe>',
  })
  await expect(html).toHaveCount(2)
  await expect(html.nth(1).locator("iframe")).toHaveAttribute("src", "https://example.com/")
})

test("a dropped PDF shows the whole document and Edit PDF opens it in the PDF viewer", async ({
  page,
}) => {
  await newBoard(page)
  await fireFiles(
    page,
    "drop",
    [500, 360],
    [
      {
        name: "plan.pdf",
        type: "application/pdf",
        bytes: pdfWithPages([["Bed plan"], ["Seed order"]]),
      },
    ],
  )
  const pdf = shapes(page, "pdf")
  await expect(pdf).toHaveCSS("width", "297.5px")
  await expect(pdf).toHaveCSS("height", "421px")
  await expect(pdf.locator("embed")).toHaveAttribute("type", "application/pdf")
  await bar(page).getByRole("button", { name: "Edit PDF" }).click()
  await expect(page.locator(".seqno-pdf .textLayer span").first()).toHaveText("Bed plan")
})
