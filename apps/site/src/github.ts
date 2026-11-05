export interface Commits {
  readonly count: number
  readonly date: string | null
}

interface CommitJson {
  readonly commit: { readonly committer: { readonly date: string } }
}

export const repo = "https://github.com/AVGVSTVS96/seqno"
export const history = `${repo}/commits/main`

export async function fetchCommits(init?: RequestInit): Promise<Commits> {
  const response = await fetch(
    "https://api.github.com/repos/AVGVSTVS96/seqno/commits?sha=main&per_page=1",
    init,
  )
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const [newest]: ReadonlyArray<CommitJson> = await response.json()
  const last = /[?&]page=(\d+)>; rel="last"/.exec(response.headers.get("link") ?? "")
  return { count: last ? Number(last[1]) : 1, date: newest?.commit.committer.date ?? null }
}

const day = 86_400_000
const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

export function ago(iso: string, now = new Date()) {
  const then = new Date(iso)
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`
  const days = Math.round((startOfDay(now) - startOfDay(then)) / day)
  if (days <= 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  return `on ${then.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}
