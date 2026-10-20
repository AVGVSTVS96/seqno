import type { Page } from "@playwright/test"

export const longOutline = (blocks: number) =>
  Array.from({ length: blocks }, (_, n) => {
    const indent = n % 5 === 0 ? "" : "\t"
    const words = n % 9 === 0 ? 70 : n % 4
    const picture = n % 25 === 12 ? ` ![](https://pictures.seqno.test/${n}.svg)` : ""
    return `${indent}- row ${n + 1}${" and more".repeat(words)}${picture}`
  }).join("\n")

export const latePictures = (page: Page) =>
  page.route("https://pictures.seqno.test/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"/>',
    })
  })
