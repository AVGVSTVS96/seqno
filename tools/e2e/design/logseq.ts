import type { Locator, Page } from "@playwright/test"
import type { Theme } from "./theme.ts"

export const references = {
  test: { name: "Logseq 2.x", url: "https://test.logseq.com/" },
  demo: { name: "Logseq classic", url: "https://demo.logseq.com/" },
} as const
export type Reference = keyof typeof references

const main = (page: Page) => page.locator("#main-content-container")

export const settled = (page: Page) =>
  page.waitForFunction(
    () =>
      document.fonts.status === "loaded" &&
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.playState !== "running" ||
            animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
        ),
  )

const isEditing = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement instanceof HTMLTextAreaElement ||
      document.querySelector("[role=dialog], #ui__ac, .ls-block.selected") !== null,
  )

const editorFocused = (page: Page) =>
  page.waitForFunction(() => document.activeElement instanceof HTMLTextAreaElement)

const editorValue = (page: Page) =>
  page.evaluate(() =>
    document.activeElement instanceof HTMLTextAreaElement ? document.activeElement.value : "",
  )

const blurFocused = (page: Page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })

export const leaveEditing = async (page: Page, tries = 4): Promise<void> => {
  if (!(await isEditing(page))) return
  if (tries === 0) return blurFocused(page)
  await page.keyboard.press("Escape")
  return leaveEditing(page, tries - 1)
}

export const openLogseq = async (page: Page, reference: Reference) => {
  await page.goto(references[reference].url, { waitUntil: "networkidle" })
  await page.locator("#head").waitFor()
  await main(page).locator(".ls-block").first().waitFor()
}

export const goHome = async (page: Page, reference: Reference) => {
  await leaveEditing(page)
  await page.goto(`${references[reference].url}#/`)
  await page.locator("#journals .journal-item").first().waitFor()
  await scrollTop(page)
}

export const goToPage = async (page: Page, reference: Reference, name: string) => {
  await leaveEditing(page)
  await page.goto(`${references[reference].url}#/page/${encodeURIComponent(name.toLowerCase())}`)
  await page.locator(".ls-page-title, h1.page-title").filter({ hasText: name }).first().waitFor()
  await scrollTop(page)
}

export const scrollTop = (page: Page) =>
  main(page).evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }))

export const shortcut = async (page: Page, keys: string) => {
  await leaveEditing(page)
  await page.keyboard.type(keys)
}

export const setTheme = async (page: Page, theme: Theme) => {
  const html = page.locator("html")
  if ((await html.getAttribute("data-theme")) === theme) return
  await shortcut(page, "tt")
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" })
}

const toggleWhen = async (page: Page, locator: Locator, wanted: boolean, keys: string) => {
  if ((await locator.count()) > 0 === wanted) return
  await shortcut(page, keys)
  await locator.waitFor({ state: wanted ? "attached" : "detached" })
}

export const setLeftSidebar = (page: Page, open: boolean) =>
  toggleWhen(page, page.locator("#left-sidebar.is-open"), open, "tl")

export const closeRightSidebar = (page: Page) =>
  toggleWhen(page, page.locator("#right-sidebar.open"), false, "tr")

const searchFocused = (page: Page) =>
  page.waitForFunction(
    () =>
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.closest(".cp__cmdk__modal") !== null,
  )

const paletteOption = (page: Page, text: string) => {
  const palette = page.locator(".cp__cmdk__modal")
  return palette
    .getByText(`Create page called '${text}'`)
    .or(palette.getByText(text, { exact: true }))
    .first()
}

export const searchFor = async (page: Page, text: string) => {
  await searchFocused(page)
  const palette = page.locator(".cp__cmdk__modal")
  await palette.locator(".search-results").first().waitFor()
  await palette.locator("input").first().fill(text)
  await paletteOption(page, text).waitFor()
}

export const openBlankPage = async (page: Page, title: string) => {
  await leaveEditing(page)
  await page.locator("#search-button").click()
  await searchFor(page, title)
  await paletteOption(page, title).click()
  await page.locator(".ls-page-title, h1.page-title").filter({ hasText: title }).first().waitFor()
}

const plainWord = /^[\p{L}\p{N}'.,:°-]+$/u

const lastPlainWords = (
  words: ReadonlyArray<string>,
  run: ReadonlyArray<string> = [],
): ReadonlyArray<string> => {
  const word = words.at(-1)
  if (word === undefined || run.length === 3) return run
  if (!plainWord.test(word)) return run.length > 0 ? run : lastPlainWords(words.slice(0, -1), run)
  return lastPlainWords(words.slice(0, -1), [word, ...run])
}

const bullets = (markdown: string) =>
  markdown
    .split("\n")
    .filter((line) => /^\s*- /.test(line))
    .map((line) => line.replace(/^\s*- /, ""))

const lastBullet = (markdown: string) => bullets(markdown).at(-1) ?? ""

const probeText = (markdown: string) =>
  bullets(markdown)
    .filter((bullet) => !bullet.startsWith("{{"))
    .map((bullet) => lastPlainWords(bullet.replace(/==|~~|[*`]/g, "").split(/\s+/)))
    .findLast((words) => words.length > 0)
    ?.join(" ") ?? ""

const startEditing = async (page: Page) => {
  if (await page.evaluate(() => document.activeElement instanceof HTMLTextAreaElement)) return
  const blank = main(page).locator(
    ".ls-page-blocks .ls-block:not(.block-add-button) .block-content",
  )
  const target =
    (await blank.count()) > 0
      ? blank.last()
      : main(page).locator(".block-add-button, .add-button-link").last()
  await target.click()
  await editorFocused(page)
}

export const pasteMarkdown = async (page: Page, markdown: string) => {
  await startEditing(page)
  await page.evaluate((text) => navigator.clipboard.writeText(text), markdown)
  await page.keyboard.press("Control+V")
  await page.waitForFunction(
    (raw) => [...document.querySelectorAll("textarea")].some((area) => area.value.includes(raw)),
    lastBullet(markdown),
  )
  await leaveEditing(page)
  await main(page).getByText(probeText(markdown)).first().waitFor()
}

export const editBlock = async (page: Page, text: string) => {
  const content = main(page).locator(".block-content").filter({ hasText: text }).last()
  await content.click()
  await editorFocused(page)
  await page.keyboard.press("End")
  return editorValue(page)
}

export const restoreBlock = async (page: Page, original: string) => {
  if ((await editorValue(page)) !== original) {
    await page.keyboard.press("Control+a")
    await page.keyboard.insertText(original)
  }
  await leaveEditing(page)
}

export const scrollToText = async (page: Page, text: string, offset: number) => {
  const target = main(page).locator(".block-content").filter({ hasText: text }).first()
  await target.waitFor({ state: "attached" })
  await target.evaluate((element, by) => {
    element.scrollIntoView({ block: "start", behavior: "instant" })
    document.querySelector("#main-content-container")?.scrollBy({ top: -by, behavior: "instant" })
  }, offset)
}
