import { strToU8, zipSync } from "fflate"
import { Schema } from "effect"
import { Block, BlockId, normalizePageName, Page, PageId } from "@seqno/domain"
import { analyzeBlock } from "@seqno/syntax"
import type { PageBlocks } from "./library.ts"

export const PublishedPage = Schema.Struct({
  page: Page,
  blocks: Schema.Array(Block),
  created: Schema.NullOr(Schema.Number),
  updated: Schema.NullOr(Schema.Number),
})

export type PublishedPage = typeof PublishedPage.Type

export const PublishedRows = Schema.TaggedUnion({
  BlockRows: { blocks: Schema.Array(BlockId) },
  PageRows: { pages: Schema.Array(PageId) },
})

export type PublishedRows = typeof PublishedRows.Type

export const PublishedReference = Schema.Struct({ blockId: BlockId, pageId: PageId })

export type PublishedReference = typeof PublishedReference.Type

export const PublishedName = Schema.Struct({ name: Schema.String, title: Schema.String })

export type PublishedName = typeof PublishedName.Type

export const Published = Schema.Struct({
  graph: Schema.String,
  theme: Schema.Literals(["light", "dark"]),
  pages: Schema.Array(PublishedPage),
  referenced: Schema.Array(PublishedName),
  references: Schema.Record(Schema.String, Schema.Array(PublishedReference)),
  queries: Schema.Record(Schema.String, PublishedRows),
  listKeys: Schema.Array(Schema.String),
})

export type Published = typeof Published.Type

export const publishedDataId = "seqno-published"

const allPublicSetting = /:(?:publishing\/)?all-pages-public\?\s+true(?![\w?-])/u

export const allPagesPublic = (configEdn: string): boolean =>
  allPublicSetting.test(configEdn.replaceAll(/;[^\n]*/gu, ""))

const publicValue = (page: Page) => page.props["public"]?.trim().toLowerCase()

const aliasesOf = (page: Page) =>
  (page.props["alias"] ?? "")
    .split(",")
    .map((part) => normalizePageName(part.trim().replace(/^\[\[(.*)\]\]$/u, "$1")))
    .filter((name) => name !== "")

export const publicPages = <P extends PageBlocks>(
  pages: readonly P[],
  allPublic: boolean,
): readonly P[] => {
  if (allPublic) {
    return pages.filter(({ page }) => publicValue(page) !== "false")
  }

  const marked = pages.filter(({ page }) => publicValue(page) === "true")
  const names = new Set(marked.map(({ page }) => page.name))
  const aliased = new Set(marked.flatMap(({ page }) => aliasesOf(page)))

  return pages.filter(
    ({ page }) =>
      names.has(page.name) ||
      aliased.has(page.name) ||
      aliasesOf(page).some((alias) => names.has(alias)),
  )
}

const assetLink = /\([./]*\/assets\/([^)]+)\)/gu

const decoded = (path: string) => {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

const textsOf = (blocks: readonly Block[]) =>
  blocks.flatMap((block) => [block.text, ...Object.values(block.props)])

export const usedAssets = (pages: readonly PageBlocks[]): readonly string[] => [
  ...new Set(
    pages.flatMap(({ page, blocks }) =>
      [...Object.values(page.props), ...textsOf(blocks)].flatMap((text) =>
        [...text.matchAll(assetLink)].flatMap((match) => {
          const path = (match[1] ?? "").split(/\s/u)[0] ?? ""

          return path === "" || path.endsWith(".js") ? [] : [`assets/${decoded(path)}`]
        }),
      ),
    ),
  ),
]

export const queriesIn = (pages: readonly PageBlocks[]): readonly string[] => [
  ...new Set(
    pages.flatMap(({ blocks }) =>
      blocks.flatMap((block) =>
        analyzeBlock(block.text).macros.flatMap((macro) =>
          macro.name === "query" && macro.args !== "" ? [macro.args] : [],
        ),
      ),
    ),
  ),
]

export const publishedRows = (
  pages: readonly PageBlocks[],
  rows: { readonly blocks: readonly Block[] } | { readonly pages: readonly Page[] },
): PublishedRows => {
  const pageIds = new Set(pages.map(({ page }) => page.id))

  return "blocks" in rows
    ? PublishedRows.cases.BlockRows.make({
        blocks: rows.blocks.filter((block) => pageIds.has(block.pageId)).map((block) => block.id),
      })
    : PublishedRows.cases.PageRows.make({
        pages: rows.pages.filter((page) => pageIds.has(page.id)).map((page) => page.id),
      })
}

const pageRefs = (text: string) =>
  analyzeBlock(text).refs.flatMap((ref) =>
    ref._tag === "BlockRef" ? [] : [[normalizePageName(ref.name), ref.name.trim()] as const],
  )

export const namesLinked = <P extends PageBlocks>(
  pages: readonly P[],
): readonly PublishedName[] => {
  const published = new Set(pages.flatMap(({ page }) => [page.name, ...aliasesOf(page)]))
  const found = new Map<string, string>()

  for (const { page, blocks } of pages) {
    for (const text of [
      ...Object.entries(page.props).map(([key, value]) => `${key}:: ${value}`),
      ...blocks.flatMap((block) => [
        block.text,
        ...Object.entries(block.props).map(([key, value]) => `${key}:: ${value}`),
      ]),
    ]) {
      for (const [name, title] of pageRefs(text)) {
        if (name !== "" && !published.has(name) && !found.has(name)) found.set(name, title)
      }
    }
  }

  return [...found].map(([name, title]) => ({ name, title }))
}

export const publishedReferences = (
  pages: readonly PageBlocks[],
  references: readonly PublishedReference[],
): readonly PublishedReference[] => {
  const blockIds = new Set(pages.flatMap(({ blocks }) => blocks.map((block) => block.id)))

  return references.filter((reference) => blockIds.has(reference.blockId))
}

export interface GraphStyle {
  readonly customCss: string
  readonly exportCss: string
  readonly customJs: string
}

export type SiteFile = readonly [path: string, bytes: Uint8Array]

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const scriptSafe = (json: string) =>
  json.replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")

const encodePublished = Schema.encodeSync(Schema.fromJsonString(Published))

export const indexHtml = (data: Published) =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <meta name="generator" content="seqno" />',
    `    <title>${escapeHtml(data.graph)}</title>`,
    '    <link rel="icon" type="image/svg+xml" href="static/img/logo.svg" />',
    '    <link rel="stylesheet" href="static/css/export.css" />',
    '    <link rel="stylesheet" href="static/css/custom.css" />',
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    `    <script id="${publishedDataId}" type="application/json">${scriptSafe(encodePublished(data))}</script>`,
    '    <script src="static/js/seqno.js"></script>',
    '    <script src="static/js/custom.js"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n")

export const notFoundHtml = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="utf-8" />',
  "    <title>Page not found</title>",
  "    <script>",
  '      location.replace(location.pathname.replace(/\\/[^/]*\\/?$/, "/") + location.hash)',
  "    </script>",
  "  </head>",
  "  <body></body>",
  "</html>",
  "",
].join("\n")

export const publicSite = (
  data: Published,
  viewer: readonly SiteFile[],
  style: GraphStyle,
  assets: readonly SiteFile[],
): readonly SiteFile[] => [
  ["index.html", strToU8(indexHtml(data))],
  ["404.html", strToU8(notFoundHtml)],
  ...viewer,
  ["static/css/custom.css", strToU8(style.customCss)],
  ["static/css/export.css", strToU8(style.exportCss)],
  ["static/js/custom.js", strToU8(style.customJs)],
  ...assets,
]

export const zipSite = (folder: string, files: readonly SiteFile[], seconds: number) =>
  zipSync(Object.fromEntries(files.map(([path, bytes]) => [`${folder}/${path}`, bytes])), {
    mtime: seconds * 1000,
  })
