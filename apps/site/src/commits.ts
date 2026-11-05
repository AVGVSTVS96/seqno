import { fetchCommits, type Commits } from "./github.ts"

const baked: Commits = { count: __COMMIT_COUNT__, date: null }
let current = baked
const listeners = new Set<() => void>()

export const commits = {
  get: () => current,
  baked: () => baked,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
  refresh: async () => {
    const live = await fetchCommits({ cache: "no-store" }).catch(() => null)
    if (!live) return
    current = { count: Math.max(live.count, baked.count), date: live.date }
    for (const listener of listeners) listener()
  },
}
