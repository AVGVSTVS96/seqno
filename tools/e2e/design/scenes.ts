import type { Page } from "@playwright/test"
import * as logseq from "./logseq.ts"
import * as seqno from "./seqno.ts"

export type Step = (missing: string, run: () => Promise<unknown>) => Promise<void>
export type Cleanup = () => Promise<void>

export interface Scene {
  readonly id: string
  readonly title: string
  readonly reference: logseq.Reference
  readonly leftSidebar: boolean
  readonly caret: boolean
  readonly logseq: (page: Page) => Promise<Cleanup>
  readonly seqno: (page: Page, step: Step) => Promise<void>
}

const editedBlock = "Talked to the plot neighbour"
const nothing: Cleanup = async () => {}

const typeInBlock = (keys: string, firstItem: string) => async (page: Page) => {
  await logseq.goHome(page, "test")
  const original = await logseq.editBlock(page, editedBlock)
  await page.keyboard.type(keys)
  await page.locator("#ui__ac").getByText(firstItem).first().waitFor()
  return () => logseq.restoreBlock(page, original)
}

const seqnoTypeInBlock = (keys: string, popup: string) => async (page: Page, step: Step) => {
  await seqno.openSeqno(page, "/")
  await step("block editor", () => seqno.editBlock(page, editedBlock))
  await page.keyboard.type(keys)
  await step(popup, () => page.getByRole("listbox").first().waitFor())
}

export const scenes: ReadonlyArray<Scene> = [
  {
    id: "journals",
    title: "Journals",
    reference: "test",
    leftSidebar: true,
    caret: false,
    logseq: async (page) => {
      await logseq.goHome(page, "test")
      return nothing
    },
    seqno: (page) => seqno.openSeqno(page, "/"),
  },
  {
    id: "page",
    title: "A page with its linked references",
    reference: "test",
    leftSidebar: true,
    caret: false,
    logseq: async (page) => {
      await logseq.goToPage(page, "test", "Garden Plan")
      return nothing
    },
    seqno: (page) => seqno.openSeqno(page, "/page/garden%20plan"),
  },
  {
    id: "showcase-top",
    title: "Showcase page, top",
    reference: "demo",
    leftSidebar: true,
    caret: false,
    logseq: async (page) => {
      await logseq.goToPage(page, "demo", "Showcase")
      return nothing
    },
    seqno: (page) => seqno.openSeqno(page, "/page/showcase"),
  },
  {
    id: "showcase-lower",
    title: "Showcase page, lower: properties, code, tasks",
    reference: "demo",
    leftSidebar: true,
    caret: false,
    logseq: async (page) => {
      await logseq.goToPage(page, "demo", "Showcase")
      await logseq.scrollToText(page, "Properties", 16)
      return nothing
    },
    seqno: async (page, step) => {
      await seqno.openSeqno(page, "/page/showcase")
      await step("the Properties heading", () => seqno.scrollToText(page, "Properties", 16))
    },
  },
  {
    id: "editing",
    title: "Editing a block",
    reference: "test",
    leftSidebar: true,
    caret: true,
    logseq: async (page) => {
      await logseq.goHome(page, "test")
      const original = await logseq.editBlock(page, editedBlock)
      return () => logseq.restoreBlock(page, original)
    },
    seqno: async (page, step) => {
      await seqno.openSeqno(page, "/")
      await step("block editor", () => seqno.editBlock(page, editedBlock))
    },
  },
  {
    id: "autocomplete",
    title: "[[ autocomplete open",
    reference: "test",
    leftSidebar: true,
    caret: true,
    logseq: typeInBlock(" [[Gar", "Garden Plan"),
    seqno: seqnoTypeInBlock(" [[Gar", "page autocomplete (role listbox)"),
  },
  {
    id: "slash",
    title: "Slash menu open",
    reference: "test",
    leftSidebar: true,
    caret: true,
    logseq: typeInBlock(" /", "Node reference"),
    seqno: seqnoTypeInBlock(" /", "slash menu (role listbox)"),
  },
  {
    id: "search",
    title: "Search palette open",
    reference: "test",
    leftSidebar: true,
    caret: false,
    logseq: async (page) => {
      await logseq.goHome(page, "test")
      await page.keyboard.press("Control+k")
      await logseq.searchFor(page, "greenhouse")
      return () => logseq.leaveEditing(page)
    },
    seqno: async (page, step) => {
      await seqno.openSeqno(page, "/")
      await page.keyboard.press("Control+k")
      await step("search palette on Mod+K (role dialog)", () =>
        page.getByRole("dialog").first().waitFor(),
      )
      await page.keyboard.type("greenhouse")
    },
  },
  {
    id: "right-sidebar",
    title: "Right sidebar open",
    reference: "test",
    leftSidebar: true,
    caret: false,
    logseq: async (page) => {
      await logseq.goHome(page, "test")
      await page
        .locator("#journals a.page-ref")
        .filter({ hasText: "Garden Plan" })
        .first()
        .click({ modifiers: ["Shift"] })
      await page.locator("#right-sidebar.open .sidebar-item").first().waitFor()
      return () => logseq.closeRightSidebar(page)
    },
    seqno: async (page, step) => {
      await seqno.openSeqno(page, "/")
      await step("Shift-click on the Garden Plan ref", () =>
        page
          .getByRole("link", { name: /Garden Plan/ })
          .first()
          .click({ modifiers: ["Shift"] }),
      )
      await step('right sidebar (complementary "Right sidebar")', () =>
        page.getByRole("complementary", { name: "Right sidebar" }).waitFor(),
      )
    },
  },
  {
    id: "left-sidebar-collapsed",
    title: "Left sidebar collapsed",
    reference: "test",
    leftSidebar: false,
    caret: false,
    logseq: async (page) => {
      await logseq.goHome(page, "test")
      return nothing
    },
    seqno: (page) => seqno.openSeqno(page, "/"),
  },
  {
    id: "all-pages",
    title: "All pages",
    reference: "test",
    leftSidebar: true,
    caret: false,
    logseq: async (page) => {
      await logseq.goHome(page, "test")
      await logseq.shortcut(page, "ga")
      await page.locator(".ls-all-pages .ls-table-row").first().waitFor()
      return nothing
    },
    seqno: async (page, step) => {
      await seqno.openSeqno(page, "/all-pages", false)
      await step("all pages table rows", () => page.getByRole("row").nth(1).waitFor())
    },
  },
]
