import type { Page } from "@playwright/test"
import { expect, openDemo } from "./test.ts"

export const board = (page: Page) => page.getByRole("application", { name: /^Whiteboard / })

export const shapes = (page: Page, type: string) =>
  board(page).locator(`.wb-shape[data-type="${type}"]`)

export const drag = async (
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 4 })
  await page.mouse.up()
}

export const newBoard = async (page: Page) => {
  await openDemo(page, "/")
  await page.keyboard.press("g")
  await page.keyboard.press("w")
  await expect(page).toHaveURL(/\/whiteboards$/)
  await expect(page).toHaveTitle("Whiteboards")
  await page.getByRole("button", { name: "New whiteboard" }).click()
  await expect(board(page)).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Whiteboard title" })).toHaveAttribute(
    "placeholder",
    "Untitled",
  )
}

export const rename = async (page: Page, title: string) => {
  const input = page.getByRole("textbox", { name: "Whiteboard title" })
  await input.fill(title)
  await input.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/page/${encodeURIComponent(title.toLowerCase())}$`))
}

export interface BoardFile {
  readonly name: string
  readonly type: string
  readonly drawn?: readonly [number, number]
  readonly bytes?: Buffer
}

export const fireFiles = (
  page: Page,
  kind: "drop" | "paste",
  at: readonly [number, number],
  files: ReadonlyArray<BoardFile>,
) =>
  page.evaluate(
    async (given) => {
      const transfer = new DataTransfer()
      for (const file of given.files) {
        const canvas = document.createElement("canvas")
        const [width, height] = file.drawn ?? [1, 1]
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext("2d")
        if (context !== null) {
          context.fillStyle = "#3a7"
          context.fillRect(0, 0, width, height)
        }
        const blob =
          file.data === null
            ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type))
            : new Blob([Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))])
        transfer.items.add(new File([blob ?? new Blob()], file.name, { type: file.type }))
      }
      const [clientX, clientY] = given.at
      const target = document.elementFromPoint(clientX, clientY) ?? document.body
      const event =
        given.kind === "paste"
          ? new ClipboardEvent("paste", {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent("drop", {
              dataTransfer: transfer,
              clientX,
              clientY,
              bubbles: true,
              cancelable: true,
            })
      target.dispatchEvent(event)
    },
    {
      kind,
      at,
      files: files.map(({ name, type, drawn, bytes }) => ({
        name,
        type,
        drawn: drawn ?? null,
        data: bytes === undefined ? null : bytes.toString("base64"),
      })),
    },
  )

export const firePaste = (
  page: Page,
  at: readonly [number, number],
  data: { readonly text?: string; readonly html?: string },
) =>
  page.evaluate(
    (given) => {
      const transfer = new DataTransfer()
      if (given.text !== null) transfer.setData("text/plain", given.text)
      if (given.html !== null) transfer.setData("text/html", given.html)
      const [x, y] = given.at
      const target = document.elementFromPoint(x, y) ?? document.body
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      )
    },
    { at, text: data.text ?? null, html: data.html ?? null },
  )
