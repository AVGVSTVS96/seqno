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

const kindOf = (url: string) => {
  const path = new URL(url).pathname
  if (/\.html?$/.test(path)) return "html"
  if (path.endsWith(".css")) return "css"
  if (/\.m?js$/.test(path)) return "js"
  return null
}

const bare = (url: string) => {
  const parsed = new URL(url)
  parsed.search = ""
  parsed.hash = ""
  return parsed.href
}

export const referencesIn = (url: string, body: string): ReadonlyArray<string> => {
  const kind = kindOf(url)
  if (kind === null) return []
  return patterns[kind].flatMap((pattern) =>
    [...body.matchAll(pattern)].flatMap(([, found]) =>
      found === undefined || /^(?:data|blob|javascript|mailto):/.test(found)
        ? []
        : [bare(new URL(found, url).href)],
    ),
  )
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
  const visit = async (url: string): Promise<void> => {
    if (!url.startsWith(root) || seen.has(url)) return
    seen.add(url)
    const response = await fetch(url)
    if (!response.ok) return
    await cache.put(url, response.clone())
    const body = kindOf(url) === null ? "" : await response.text()
    await Promise.all(referencesIn(url, body).map(visit))
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
