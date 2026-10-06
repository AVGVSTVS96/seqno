import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { editBlock, openSeqno } from "../design/seqno.ts"
import { materializeShowcase } from "../design/showcase.ts"
import { themes } from "../design/theme.ts"
import { appAvailable } from "../src/env.ts"
import { seedOpfs } from "../src/opfs.ts"
import { expect, test } from "../src/test.ts"

test.skip(
  !appAvailable || process.env["SEQNO_SCREENS"] === undefined,
  "set SEQNO_SCREENS=1 to refresh docs/screens",
)

test.use({ viewport: { width: 1440, height: 900 } })

const shoot = async (page: Page, name: string) => {
  await page.mouse.move(1436, 896)
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  )
  await page.screenshot({
    path: fileURLToPath(new URL(`../../../docs/screens/${name}.png`, import.meta.url)),
  })
}

for (const theme of themes) {
  test(`screenshots of the running app, ${theme}`, async ({ page }) => {
    const showcase = await materializeShowcase(new Date())
    await seedOpfs(page, showcase, ["graphs", "demo"])
    await rm(showcase, { recursive: true })
    await page.evaluate((chosen) => {
      localStorage.setItem("seqno.theme", JSON.stringify(chosen))
      localStorage.setItem("seqno.leftSidebar", "true")
    }, theme)

    await openSeqno(page, "/")
    await shoot(page, `journals-${theme}`)

    await page
      .getByRole("link", { name: /Garden Plan/ })
      .first()
      .click({ modifiers: ["Shift"] })
    await expect(page.getByRole("complementary", { name: "Right sidebar" })).toBeVisible()
    await shoot(page, `right-sidebar-${theme}`)
    await page.getByRole("button", { name: "Toggle right sidebar" }).click()

    await page.getByRole("button", { name: "Search", exact: true }).click()
    await page.getByRole("searchbox", { name: "Search" }).fill("greenhouse")
    await expect(
      page.getByRole("listbox", { name: "Nodes" }).getByRole("option").first(),
    ).toBeVisible()
    await shoot(page, `search-${theme}`)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")

    await openSeqno(page, "/page/garden%20plan")
    await shoot(page, `page-${theme}`)

    await openSeqno(page, "/page/showcase")
    await shoot(page, `showcase-${theme}`)

    await openSeqno(page, "/all-pages", false)
    await expect(page.getByRole("link", { name: "Garden Plan" }).first()).toBeVisible()
    await shoot(page, `all-pages-${theme}`)

    await openSeqno(page, "/")
    await editBlock(page, "Talked to the plot neighbour")
    await page.keyboard.type(" [[Gar")
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible()
    await shoot(page, `editing-${theme}`)
  })
}
