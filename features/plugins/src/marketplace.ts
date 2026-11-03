import { list, pluginInfoOf, record, text, type Listing } from "./package.ts"
import type { PluginInfo } from "./state.ts"

const central = "https://raw.githubusercontent.com/logseq/marketplace/master/"

export const mirror = "https://pub-80f42b85b62c40219354a834fcf2bbfa.r2.dev/"

export const urls = {
  index: `${central}plugins.json`,
  stats: `${central}stats.json`,
  icon: (id: string, icon: string) => `${central}packages/${id}/${icon.replace(/^\.\//, "")}`,
  package: (repo: string) => `https://plugins.logseq.io/r2/${repo}`,
  files: (repo: string, version: string) => `${mirror}${repo}/${version}/`,
}

export interface MarketItem extends Listing {
  readonly repo: string
  readonly theme: boolean
  readonly addedAt: number
  readonly stars: number
  readonly downloads: number
}

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

const statsOf = (stats: unknown, id: string) => {
  const entry = record(record(stats)[id])
  const stars = entry["stargazers_count"]
  const downloads = list(entry["releases"]).reduce<number>((sum, release) => {
    const count = list(release)[2]
    return sum + (typeof count === "number" ? count : 0)
  }, 0)
  return { stars: typeof stars === "number" ? stars : 0, downloads }
}

export const loadMarket = async (): Promise<ReadonlyArray<MarketItem>> => {
  const [index, stats] = await Promise.all([
    fetchJson(urls.index),
    fetchJson(urls.stats).catch(() => ({})),
  ])
  return list(record(index)["packages"]).flatMap((entry) => {
    const item = record(entry)
    const id = text(item["id"])
    const repo = text(item["repo"])
    if (id === null || repo === null) return []
    if (item["effect"] === true && item["web"] !== true) return []
    const icon = text(item["icon"])
    const addedAt = item["addedAt"]
    return [
      {
        id,
        repo,
        title: text(item["title"]) ?? id,
        description: text(item["description"]) ?? "",
        author: text(item["author"]) ?? "",
        icon: icon === null ? null : urls.icon(id, icon),
        theme: item["theme"] === true,
        addedAt: typeof addedAt === "number" ? addedAt : 0,
        ...statsOf(stats, id),
      },
    ]
  })
}

export const fetchPlugin = async (
  item: Listing & { readonly repo: string },
): Promise<PluginInfo> => {
  const pkg = record(await fetchJson(urls.package(item.repo)))
  const version = text(pkg["version"])
  if (version === null) throw new Error(`${item.repo} has no published version`)
  return pluginInfoOf(item, urls.files(item.repo, version), pkg)
}
