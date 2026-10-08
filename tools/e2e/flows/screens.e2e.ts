import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { editBlock, openSeqno } from "../design/seqno.ts"
import { materializeShowcase } from "../design/showcase.ts"
import { type Theme, themes } from "../design/theme.ts"
import { appAvailable } from "../src/env.ts"
import { seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(
  !appAvailable || process.env["SEQNO_SCREENS"] === undefined,
  "set SEQNO_SCREENS=1 to refresh docs/screenshots",
)

const viewport = { width: 1440, height: 900 }
const margin = 48

test.use({ viewport, deviceScaleFactor: 2 })

const edges: Record<Theme, string> = {
  light: "rgb(0 0 0 / 0.08)",
  dark: "rgb(255 255 255 / 0.1)",
}

const frame = async (page: Page, shot: Buffer, theme: Theme, name: string) => {
  const framed = await page.context().newPage()
  await framed.setViewportSize({
    width: viewport.width + margin * 2,
    height: viewport.height + margin * 2,
  })
  await framed.setContent(
    `<body style="margin:0;background:transparent"><div id="frame" style="display:inline-block;padding:${margin}px"><img src="data:image/png;base64,${shot.toString("base64")}" style="display:block;width:${viewport.width}px;border-radius:12px;box-shadow:0 0 0 1px ${edges[theme]},0 24px 48px -16px rgb(0 0 0 / 0.3)"></div></body>`,
  )
  await framed.locator("#frame").screenshot({
    path: fileURLToPath(new URL(`../../../docs/screenshots/${name}.png`, import.meta.url)),
    omitBackground: true,
  })
  await framed.close()
}

const shoot = async (page: Page, theme: Theme, name: string) => {
  await page.mouse.move(viewport.width - 4, viewport.height - 4)
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  )
  await frame(page, await page.screenshot(), theme, `${name}-${theme}`)
}

for (const theme of themes) {
  test(`screenshots for the README, ${theme}`, async ({ page }) => {
    const showcase = await materializeShowcase(new Date())
    await seedOpfs(page, showcase, ["graphs", "demo"])
    await rm(showcase, { recursive: true })
    await page.evaluate((chosen) => {
      localStorage.setItem("seqno.theme", JSON.stringify(chosen))
      localStorage.setItem("seqno.leftSidebar", "true")
    }, theme)

    await openSeqno(page, "/page/showcase")
    await shoot(page, theme, "showcase")

    await openSeqno(page, "/")
    await page
      .getByRole("link", { name: /Garden Plan/ })
      .first()
      .click({ modifiers: ["Shift"] })
    await expect(page.getByRole("complementary", { name: "Right sidebar" })).toBeVisible()
    await shoot(page, theme, "sidebar")
    await page.getByRole("button", { name: "Toggle right sidebar" }).click()

    await page.getByRole("button", { name: "Search", exact: true }).click()
    await page.getByRole("searchbox", { name: "Search" }).fill("greenhouse")
    await expect(
      page.getByRole("listbox", { name: "Nodes" }).getByRole("option").first(),
    ).toBeVisible()
    await shoot(page, theme, "search")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")

    await openSeqno(page, "/")
    await editBlock(page, "The seedlings have their first true leaves")
    await page.keyboard.type(" [[Gar")
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible()
    await shoot(page, theme, "editing")
  })
}
