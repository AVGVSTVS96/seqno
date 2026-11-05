import type { Locator, Page } from "@playwright/test"
import { appAvailable } from "../src/env.ts"
import { opfsFiles } from "../src/opfs.ts"
import { pdfWithPages } from "../src/pdf.ts"
import { expect, test } from "../src/test.ts"

test.skip(!appAvailable, "waits on apps/web")

const welcome = "Welcome to the seqno demo graph"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

interface Upload {
  readonly name: string
  readonly type: string
  readonly bytes: Buffer
}

const sent = (files: readonly Upload[]) =>
  files.map(({ name, type, bytes }) => ({ name, type, data: bytes.toString("base64") }))

const fire = async (target: Locator, kind: "paste" | "drop", files: readonly Upload[]) => {
  await target.evaluate(
    (element, given) => {
      const transfer = new DataTransfer()

      for (const file of given.files) {
        const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
        transfer.items.add(new File([bytes], file.name, { type: file.type }))
      }

      const event =
        given.kind === "paste"
          ? new ClipboardEvent("paste", {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true })

      element.dispatchEvent(event)
    },
    { kind, files: sent(files) },
  )
}

const assetNames = async (page: Page) =>
  Object.keys(await opfsFiles(page, ["graphs", "demo", "assets"])).toSorted()

const welcomeRow = (page: Page) =>
  page.getByRole("main").getByRole("treeitem").filter({ hasText: welcome }).first()

test("pasting an image saves it in assets/ and links it, as Logseq does", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await welcomeRow(page).click()
  await page.keyboard.press("End")
  await fire(seqno.editor, "paste", [{ name: "image.png", type: "image/png", bytes: png }])
  await expect(seqno.editor).toHaveText(
    new RegExp(`^${welcome} !\\[image\\.png\\]\\(\\.\\./assets/image_\\d{13}_0\\.png\\)$`),
  )
  await page.keyboard.press("Escape")
  const image = welcomeRow(page).getByRole("img", { name: "image.png" })
  await expect(image).toHaveJSProperty("naturalWidth", 1)
  expect(await assetNames(page)).toEqual([expect.stringMatching(/^image_\d{13}_0\.png$/u)])
  await seqno.saved()
  await page.reload()
  await expect(welcomeRow(page).getByRole("img", { name: "image.png" })).toHaveJSProperty(
    "naturalWidth",
    1,
  )
})

test("dropping files on a block adds a block that plays, reads and downloads them", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await fire(welcomeRow(page), "drop", [
    { name: "Field notes.pdf", type: "application/pdf", bytes: pdfWithPages([["Field notes"]]) },
    { name: "birdsong.mp3", type: "audio/mpeg", bytes: Buffer.from("ID3") },
    { name: "plan.docx", type: "application/octet-stream", bytes: Buffer.from("docx") },
  ])
  const added = page.getByRole("main").getByRole("treeitem").nth(1)
  await expect(added.locator('a.seqno-asset[data-kind="pdf"]')).toHaveText("Field notes.pdf")
  await expect(added.locator("audio[controls]")).toHaveAttribute("src", /^blob:/u)
  const download = page.waitForEvent("download")
  await added.getByRole("link", { name: "plan.docx" }).click()
  expect((await download).suggestedFilename()).toMatch(/^plan_\d{13}_2\.docx$/u)
  await added.click()
  await expect(seqno.editor).toHaveText(
    /^!\[Field notes\.pdf\]\(\.\.\/assets\/Field_notes_\d{13}_0\.pdf\) !\[birdsong\.mp3\]\(\.\.\/assets\/birdsong_\d{13}_1\.mp3\) \[plan\.docx\]\(\.\.\/assets\/plan_\d{13}_2\.docx\)$/u,
  )
})

test("/Upload an asset picks a file and puts its link where the slash was", async ({
  page,
  seqno,
}) => {
  await seqno.openDemoGraph()
  await welcomeRow(page).click()
  await page.keyboard.press("End")
  await page.keyboard.type(" /upload")
  const chooser = page.waitForEvent("filechooser")
  await page.keyboard.press("Enter")
  await (await chooser).setFiles({ name: "chart.png", mimeType: "image/png", buffer: png })
  await expect(seqno.editor).toHaveText(
    new RegExp(`^${welcome} !\\[chart\\.png\\]\\(\\.\\./assets/chart_\\d{13}_0\\.png\\)$`),
  )
})
