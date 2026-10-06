import { mkdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { chromium, type Browser, type Page } from "@playwright/test"
import { Schema } from "effect"
import { readNotes, writeCompare, writeNotes, type Notes } from "./compare.ts"
import * as logseq from "./logseq.ts"
import { scenes, type Scene, type Step } from "./scenes.ts"
import * as seqno from "./seqno.ts"
import {
  assetPath,
  materializeShowcase,
  showcaseJournals,
  showcasePage,
  withoutPageProperties,
} from "./showcase.ts"
import { themes, type Theme } from "./theme.ts"

const viewport = { width: 1440, height: 900 }
const assetHost = "https://showcase.seqno.invalid/"
const restingPointer = { x: 1436, y: 896 }

const sceneIds = new Set(scenes.map((scene) => scene.id))

const Options = Schema.Struct({
  scenes: Schema.Array(
    Schema.String.check(
      Schema.makeFilter(
        (id) => sceneIds.has(id) || `unknown scene; pick from ${[...sceneIds].join(", ")}`,
      ),
    ),
  ),
  theme: Schema.optionalKey(Schema.Literals(themes)),
  app: Schema.optionalKey(Schema.Literals(["logseq", "seqno"])),
  out: Schema.String,
  baseURL: Schema.optionalKey(Schema.URLFromString),
})

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: "string" },
    app: { type: "string" },
    out: { type: "string", default: fileURLToPath(new URL("../design-out/", import.meta.url)) },
  },
})

const options = Schema.decodeUnknownSync(Options)({
  scenes: parsed.positionals,
  ...(parsed.values.theme === undefined ? {} : { theme: parsed.values.theme }),
  ...(parsed.values.app === undefined ? {} : { app: parsed.values.app }),
  out: parsed.values.out,
  ...(process.env["SEQNO_E2E_BASE_URL"] === undefined
    ? {}
    : { baseURL: process.env["SEQNO_E2E_BASE_URL"] }),
})

const chosenScenes = scenes.filter(
  (scene) => options.scenes.length === 0 || options.scenes.includes(scene.id),
)
const chosenThemes = themes.filter(
  (theme) => options.theme === undefined || options.theme === theme,
)
const wants = (app: "logseq" | "seqno") => options.app === undefined || options.app === app
const shot = (scene: Scene, theme: Theme, app: "logseq" | "seqno") =>
  join(options.out, `${scene.id}-${theme}.${app}.png`)

const today = new Date()
const notes: Record<string, { logseq: Array<string>; seqno: Array<string> }> = Object.fromEntries(
  Object.entries(await readNotes(options.out).catch((): Notes => ({}))).map(([key, value]) => [
    key,
    { logseq: [...value.logseq], seqno: [...value.seqno] },
  ]),
)
const noteFor = (scene: Scene, theme: Theme) => {
  const key = `${scene.id}-${theme}`
  notes[key] ??= { logseq: [], seqno: [] }
  return notes[key]
}

const problem = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "unknown error"

const capture = async (page: Page, path: string, caret: boolean) => {
  await page.mouse.move(restingPointer.x, restingPointer.y)
  await logseq.settled(page)
  await page.screenshot({ path, caret: caret ? "initial" : "hide" })
  console.log(`  ${basename(path)}`)
}

const prepare: Record<logseq.Reference, (page: Page) => Promise<void>> = {
  test: async (page) => {
    const [latest, ...earlier] = await showcaseJournals(today)
    await logseq.goHome(page, "test")
    await logseq.pasteMarkdown(page, latest?.markdown ?? "")
    for (const journal of earlier) {
      await logseq.openBlankPage(page, journal.title)
      await logseq.pasteMarkdown(page, journal.markdown)
    }
    for (const file of ["Garden Plan.md", "Reading List.md"]) {
      await logseq.openBlankPage(page, file.replace(/\.md$/, ""))
      await logseq.pasteMarkdown(page, withoutPageProperties(await showcasePage(file)))
    }
  },
  demo: async (page) => {
    await page.addStyleTag({
      content: ".cp__sidebar-main-content > .admonitionblock.warning { display: none }",
    })
    await logseq.openBlankPage(page, "Showcase")
    const markdown = (await showcasePage("Showcase.md")).replaceAll("../assets/", assetHost)
    await logseq.pasteMarkdown(page, markdown)
  },
}

const captureLogseq = async (browser: Browser, reference: logseq.Reference) => {
  const context = await browser.newContext({
    viewport,
    permissions: ["clipboard-read", "clipboard-write"],
  })
  await context.route(`${assetHost}**`, (route) =>
    route.fulfill({ path: assetPath(basename(new URL(route.request().url()).pathname)) }),
  )
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  console.log(`${logseq.references[reference].name}: loading and pasting the showcase`)
  await logseq
    .openLogseq(page, reference)
    .then(() => prepare[reference](page))
    .catch(async (error: unknown) => {
      await page.screenshot({ path: join(options.out, `debug-${reference}.png`) })
      throw error
    })
  for (const theme of chosenThemes) {
    await logseq.setTheme(page, theme)
    for (const scene of chosenScenes.filter((candidate) => candidate.reference === reference)) {
      const note = noteFor(scene, theme)
      note.logseq = []
      const cleanup = await logseq
        .setLeftSidebar(page, scene.leftSidebar)
        .then(() => scene.logseq(page))
        .catch((error: unknown) => {
          note.logseq.push(problem(error))
          return () => logseq.leaveEditing(page)
        })
      await capture(page, shot(scene, theme, "logseq"), scene.caret)
      await cleanup()
      await logseq.closeRightSidebar(page)
    }
  }
  await context.close()
}

const captureSeqnoScene = async (
  browser: Browser,
  baseURL: URL,
  showcase: string,
  scene: Scene,
  theme: Theme,
) => {
  const note = noteFor(scene, theme)
  note.seqno = []
  const step: Step = async (missing, run) => {
    await run().catch(() => note.seqno.push(`missing: ${missing}`))
  }
  const page = await seqno.seqnoPage(browser, {
    baseURL: baseURL.href,
    showcase,
    theme,
    leftSidebar: scene.leftSidebar,
  })
  const report = (error: unknown) => {
    note.seqno.push(problem(error))
  }
  await scene.seqno(page, step).catch(report)
  await capture(page, shot(scene, theme, "seqno"), scene.caret).catch(report)
  await page.context().close()
}

const captureSeqno = async (browser: Browser, baseURL: URL) => {
  const showcase = await materializeShowcase(today)
  console.log(`seqno at ${baseURL.href}`)
  try {
    for (const theme of chosenThemes) {
      for (const scene of chosenScenes) {
        await captureSeqnoScene(browser, baseURL, showcase, scene, theme)
      }
    }
  } finally {
    await rm(showcase, { recursive: true })
  }
}

await mkdir(options.out, { recursive: true })
const browser = await chromium.launch({ channel: "chrome", headless: true })
try {
  if (wants("logseq")) {
    const used = new Set(chosenScenes.map((scene) => scene.reference))
    for (const reference of used) await captureLogseq(browser, reference)
  }
  if (wants("seqno")) {
    if (options.baseURL === undefined) {
      throw new Error(
        "Set SEQNO_E2E_BASE_URL to your running seqno preview, for example http://localhost:4181/",
      )
    }
    await captureSeqno(browser, options.baseURL)
  }
} finally {
  await browser.close()
  await writeNotes(options.out, notes)
  await writeCompare(options.out)
  console.log(`compare: ${join(options.out, "compare.html")}`)
}
