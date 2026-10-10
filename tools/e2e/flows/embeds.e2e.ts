import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { seedOpfs } from "../src/opfs.ts"
import { expect, openDemo, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

const stubRemote = async (page: Page) => {
  await page.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  )
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  )
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>player</title>" }),
  )
}

const openVideosPage = async (page: Page, folder: string) => {
  await mkdir(join(folder, "pages"), { recursive: true })
  await writeFile(
    join(folder, "pages", "videos.md"),
    [
      "- {{video https://www.youtube.com/watch?v=dQw4w9WgXcQ}}",
      "- Jump to the chorus {{youtube-timestamp 1:30}}",
      "- {{video https://example.com/clips/demo.mp4}}",
      "- ![a remote picture](https://example.com/picture.png)",
    ].join("\n"),
  )
  await seedOpfs(page, folder, ["graphs", "demo"])
  await stubRemote(page)
  await openDemo(page, "/page/videos")
}

test("a YouTube embed waits as a thumbnail, and a timestamp starts it at that second", async ({
  page,
}, testInfo) => {
  await openVideosPage(page, testInfo.outputPath("graph"))
  const main = page.getByRole("main")
  const play = main.getByRole("button", { name: "Play video" })
  await expect(play.locator("img")).toHaveAttribute(
    "src",
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  )
  await expect(main.locator("iframe")).toHaveCount(0)
  await main.getByRole("button", { name: "1:30" }).click()
  await expect(main.getByTitle("YouTube video")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&enablejsapi=1&rel=0&start=90",
  )
  await expect(main.getByRole("textbox")).toHaveCount(0)
})

test("clicking the thumbnail plays the video in place instead of editing the block", async ({
  page,
}, testInfo) => {
  await openVideosPage(page, testInfo.outputPath("graph"))
  const main = page.getByRole("main")
  await main.getByRole("button", { name: "Play video" }).click()
  await expect(main.getByTitle("YouTube video")).toHaveAttribute(
    "src",
    /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1&enablejsapi=1&rel=0&start=0$/,
  )
  await expect(main.getByRole("textbox")).toHaveCount(0)
})

test("a direct video file plays in a video element, and a remote image shows", async ({
  page,
}, testInfo) => {
  await openVideosPage(page, testInfo.outputPath("graph"))
  const main = page.getByRole("main")
  await expect(main.locator("video")).toHaveAttribute("src", "https://example.com/clips/demo.mp4")
  await expect(main.getByRole("img", { name: "a remote picture" })).toHaveAttribute(
    "src",
    "https://example.com/picture.png",
  )
  await expect
    .poll(() =>
      main
        .getByRole("img", { name: "a remote picture" })
        .evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth),
    )
    .toBe(1)
})
