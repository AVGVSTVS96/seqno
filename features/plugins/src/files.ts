import { mirror } from "./marketplace.ts"
import type { PluginInfo } from "./state.ts"

export const pluginFiles = { path: "lsp/", cache: "seqno-plugins" } as const

const localRoot = () =>
  new URL(`${import.meta.env.BASE_URL}${pluginFiles.path}`, location.href).href

export const local = (url: string) =>
  url.startsWith(mirror) ? `${localRoot()}${url.slice(mirror.length)}` : url

const patterns = {
  html: [/\s(?:src|href)\s*=\s*["']?([^"'\s>]+)/g],
  css: [/url\(\s*["']?([^"')]+?)["']?\s*\)/g, /@import\s+["']([^"']+)["']/g],
  js: [
    /(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s*|\bnew URL\(\s*)["'`]((?:\.{1,2}\/)[^"'`\s]+)["'`]/g,
  ],
} as const

const elsewhere = {
  html: [/<script\b[^>]*?\ssrc\s*=\s*["']?([^"'\s>]+)/g],
  css: patterns.css,
  js: [],
} as const

const kindOf = (url: string, type = "") => {
  const path = new URL(url).pathname
  if (/\.html?$/.test(path) || type.startsWith("text/html")) return "html"
  if (path.endsWith(".css") || type.startsWith("text/css")) return "css"
  if (/\.m?js$/.test(path) || type.includes("javascript")) return "js"
  return null
}

const unhashed = (url: string) => {
  const parsed = new URL(url)
  parsed.hash = ""
  return parsed.href
}

const bare = (url: string) => {
  const parsed = new URL(url)
  parsed.search = ""
  parsed.hash = ""
  return parsed.href
}

const matches = (url: string, body: string, found: ReadonlyArray<RegExp>) =>
  found.flatMap((pattern) =>
    [...body.matchAll(pattern)].flatMap(([, match]) =>
      match === undefined || /^(?:data|blob|javascript|mailto):/.test(match)
        ? []
        : [new URL(match, url).href],
    ),
  )

export const referencesIn = (url: string, body: string, type = ""): ReadonlyArray<string> => {
  const kind = kindOf(url, type)
  return kind === null ? [] : matches(url, body, patterns[kind]).map(bare)
}

const fallbackFont = /\.(?:woff|ttf|otf|eot)(?:[?#]|$)/

export const elsewhereIn = (url: string, body: string, type = ""): ReadonlyArray<string> => {
  const kind = kindOf(url, type)
  if (kind === null) return []
  const found = matches(url, body, elsewhere[kind]).filter(
    (ref) => new URL(ref).origin !== location.origin,
  )
  const woff2 = found.some((ref) => /\.woff2(?:[?#]|$)/.test(ref))
  return found.filter((ref) => !(woff2 && fallbackFont.test(ref))).map(unhashed)
}

export const entryOf = (info: PluginInfo) =>
  info.main === null ? null : new URL(info.main, local(info.root)).href

const startsOf = (info: PluginInfo) =>
  [entryOf(info), info.icon, ...info.themes.map((theme) => theme.url)].flatMap((url) =>
    url === null ? [] : [bare(local(url))],
  )

const canKeep = () => typeof caches !== "undefined"

export const keepCopy = async (info: PluginInfo) => {
  if (!canKeep()) return
  const root = local(info.root)
  const cache = await caches.open(pluginFiles.cache)
  const seen = new Set<string>()
  const store = async (url: string) => {
    seen.add(url)
    const response = await fetch(url)
    if (!response.ok) return null
    await cache.put(url, response.clone())
    const type = response.headers.get("content-type") ?? ""
    return { type, body: kindOf(url, type) === null ? "" : await response.text() }
  }
  const away = async (url: string): Promise<void> => {
    if (seen.has(url) || !/^https?:/.test(url)) return
    const file = await store(url).catch(() => null)
    if (file !== null) await Promise.all(elsewhereIn(url, file.body, file.type).map(away))
  }
  const visit = async (url: string): Promise<void> => {
    if (!url.startsWith(root) || seen.has(url)) return
    const file = await store(url)
    if (file === null) return
    await Promise.all([
      ...referencesIn(url, file.body, file.type).map(visit),
      ...elsewhereIn(url, file.body, file.type).map(away),
    ])
  }
  await Promise.all(startsOf(info).map(visit))
}

export const ensureCopy = async (info: PluginInfo) => {
  if (!canKeep()) return
  const [first] = startsOf(info)
  if (first === undefined || (await caches.match(first, { ignoreVary: true })) !== undefined) return
  await keepCopy(info)
}

export const dropCopy = async (info: PluginInfo) => {
  if (!canKeep()) return
  const root = local(info.root)
  const cache = await caches.open(pluginFiles.cache)
  const kept = await cache.keys()
  await Promise.all(
    kept.filter((request) => request.url.startsWith(root)).map((request) => cache.delete(request)),
  )
}
