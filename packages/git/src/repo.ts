import * as git from "isomorphic-git"
import type { PromiseFsClient, WalkerEntry } from "isomorphic-git"
import { patch, type Change, type Side } from "./diff.ts"
import { formatDate, quotePath, subjectOf, type CommitInfo } from "./format.ts"

export type FsClient = PromiseFsClient

export interface Globals {
  readonly read: () => Promise<Readonly<Record<string, string>>>
  readonly write: (config: Readonly<Record<string, string>>) => Promise<void>
}

export interface RepoOptions {
  readonly fs: FsClient
  readonly globals: Globals
  readonly now?: () => Date
  readonly lock?: () => Promise<(() => Promise<void>) | null>
}

export interface Identity {
  readonly name: string
  readonly email: string
}

export type Committed =
  | { readonly _tag: "Committed"; readonly oid: string }
  | { readonly _tag: "NothingToCommit" }
  | { readonly _tag: "NoIdentity" }
  | { readonly _tag: "Busy" }

export interface Version {
  readonly oid: string
  readonly subject: string
  readonly date: string
}

export type Row = readonly [path: string, head: number, workdir: number, stage: number]

export type Target =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Tree"; readonly ref: string }
  | { readonly _tag: "Stage" }
  | { readonly _tag: "Workdir" }

export const dir = "/"
export const gitdir = "/.git"

const notFound = (cause: unknown) =>
  cause instanceof Error && "code" in cause && cause.code === "NotFoundError"

const orNull = <A>(promise: Promise<A>) =>
  promise.catch((cause: unknown) => (notFound(cause) ? null : Promise.reject(cause)))

const staged = (rows: ReadonlyArray<Row>) =>
  rows.some(
    ([, headState, , stage]) =>
      !(headState === 1 && stage === 1) && !(headState === 0 && stage === 0),
  )

const walkerOf = (target: Exclude<Target, { readonly _tag: "Empty" }>) =>
  target._tag === "Tree"
    ? git.TREE({ ref: target.ref })
    : target._tag === "Stage"
      ? git.STAGE()
      : git.WORKDIR()

export const makeRepo = ({ fs, globals, now = () => new Date(), lock }: RepoOptions) => {
  const cache = {}
  const at = { fs, dir, gitdir, cache }

  const exists = () =>
    fs.promises.stat(`${gitdir}/HEAD`).then(
      () => true,
      () => false,
    )

  const ensure = async () => {
    if (await exists()) return false
    await git.init({ fs, dir, gitdir, defaultBranch: "master" })
    return true
  }

  const repoConfig = async (key: string) => {
    const value: unknown = await git
      .getConfig({ fs, dir, gitdir, path: key })
      .catch(() => undefined)
    return typeof value === "string" || typeof value === "boolean" || typeof value === "number"
      ? String(value)
      : undefined
  }

  const config = async (key: string) =>
    (await repoConfig(key)) ?? (await globals.read())[key.toLowerCase()]

  const setGlobal = async (key: string, value: string | undefined) => {
    const current = { ...(await globals.read()) }
    if (value === undefined) delete current[key.toLowerCase()]
    else current[key.toLowerCase()] = value
    await globals.write(current)
  }

  const setRepoConfig = (key: string, value: string | undefined) =>
    git.setConfig({ fs, dir, gitdir, path: key, value })

  const identity = async (): Promise<Identity | null> => {
    const name = await config("user.name")
    const email = await config("user.email")
    return name === undefined || email === undefined || name.trim() === "" || email.trim() === ""
      ? null
      : { name, email }
  }

  const head = () => orNull(git.resolveRef({ fs, dir, gitdir, ref: "HEAD" }))

  const branch = async () =>
    (await git.currentBranch({ fs, dir, gitdir, fullname: false }).catch(() => undefined)) ??
    "master"

  const matrix = async (filepaths?: ReadonlyArray<string>): Promise<ReadonlyArray<Row>> =>
    git.statusMatrix({ ...at, ...(filepaths === undefined ? {} : { filepaths: [...filepaths] }) })

  const stage = async (rows: ReadonlyArray<Row>) => {
    for (const [filepath, , workdir, stageState] of rows) {
      if (workdir === 0) {
        if (stageState !== 0) await git.remove({ ...at, filepath })
      } else if (workdir === 1 ? stageState !== 1 : stageState !== 2) {
        await git.add({ ...at, filepath })
      }
    }
  }

  const stageAll = async () => stage(await matrix())

  const commit = async (
    message: string,
    options: { readonly allowEmpty?: boolean } = {},
  ): Promise<Committed> => {
    const author = await identity()
    if (author === null) return { _tag: "NoIdentity" }
    if (options.allowEmpty !== true && !staged(await matrix())) return { _tag: "NothingToCommit" }
    const date = now()
    const oid = await git.commit({
      ...at,
      message,
      author: {
        ...author,
        timestamp: Math.floor(date.getTime() / 1000),
        timezoneOffset: date.getTimezoneOffset(),
      },
    })
    return { _tag: "Committed", oid }
  }

  const locked = async <A>(run: () => Promise<A>, busy: A) => {
    const release = lock === undefined ? async () => undefined : await lock()
    if (release === null) return busy
    try {
      return await run()
    } finally {
      await release()
    }
  }

  const commitAll = (message: string): Promise<Committed> =>
    locked(
      async () => {
        await ensure()
        await stageAll()
        return commit(message.trim() === "" ? "Auto saved by Logseq" : message)
      },
      { _tag: "Busy" },
    )

  const readCommit = async (oid: string): Promise<CommitInfo> => {
    const { commit: object } = await git.readCommit({ ...at, oid })
    return { oid, ...object }
  }

  const commits = async (
    ref: string,
    options: { readonly depth?: number; readonly filepath?: string } = {},
  ) => {
    const found = await orNull(
      git.log({
        ...at,
        ref,
        ...(options.depth === undefined ? {} : { depth: options.depth }),
        ...(options.filepath === undefined ? {} : { filepath: options.filepath }),
      }),
    )
    return (found ?? []).map((entry): CommitInfo => ({ oid: entry.oid, ...entry.commit }))
  }

  const history = async (path: string, depth = 100): Promise<ReadonlyArray<Version>> => {
    if ((await head()) === null) return []
    const found = await commits("HEAD", { depth, filepath: path }).catch(() => [])
    return found.map((entry) => ({
      oid: entry.oid,
      subject: subjectOf(entry.message.trimEnd()),
      date: formatDate(entry.author, "default", now()),
    }))
  }

  const readBlob = async (oid: string, filepath?: string) => {
    const found = await orNull(
      git.readBlob({ ...at, oid, ...(filepath === undefined ? {} : { filepath }) }),
    )
    return found === null ? null : { oid: found.oid, bytes: found.blob }
  }

  const show = async (oid: string, path: string) => {
    const blob = await readBlob(oid, path)
    return blob === null ? null : new TextDecoder().decode(blob.bytes)
  }

  const quoting = async (overrides: ReadonlyMap<string, string>) => {
    const value = overrides.get("core.quotepath") ?? (await config("core.quotepath"))
    return value === undefined || !["false", "no", "off", "0"].includes(value.toLowerCase())
  }

  const porcelain = async (overrides: ReadonlyMap<string, string> = new Map()) => {
    const rows = await matrix()
    const quoteNonAscii = await quoting(overrides)
    const quote = (path: string) => quotePath(path, { quoteNonAscii, quoteSpace: true })
    const indexed = new Set<string>()
    for (const [path, , , stageState] of rows) {
      if (stageState === 0) continue
      const parts = path.split("/")
      for (let n = 1; n < parts.length; n += 1) indexed.add(`${parts.slice(0, n).join("/")}/`)
    }
    const shownAs = (path: string) => {
      const parts = path.split("/")
      for (let n = 1; n < parts.length; n += 1) {
        const prefix = `${parts.slice(0, n).join("/")}/`
        if (!indexed.has(prefix)) return prefix
      }
      return path
    }
    const changed: Array<string> = []
    const untracked = new Set<string>()
    for (const [path, headState, workdir, stageState] of rows) {
      if (stageState === 0 && workdir !== 0) untracked.add(shownAs(path))
      if (headState === 0 && stageState === 0) continue
      const x = headState === 0 ? "A" : stageState === 0 ? "D" : stageState === 1 ? " " : "M"
      const y =
        stageState === 0
          ? " "
          : workdir === 0
            ? "D"
            : stageState === 2 || (stageState === 1 && workdir === 1)
              ? " "
              : "M"
      if (x !== " " || y !== " ") changed.push(`${x}${y} ${quote(path)}\n`)
    }
    return [...changed, ...[...untracked].toSorted().map((path) => `?? ${quote(path)}\n`)].join("")
  }

  const blobOf = async (entry: WalkerEntry | null, fromWorkdir: boolean): Promise<Side | null> => {
    if (entry === null) return null
    const oid = await entry.oid()
    if (fromWorkdir) {
      const content = await entry.content()
      return { oid, bytes: content ?? new Uint8Array() }
    }
    const blob = await readBlob(oid)
    return blob === null ? null : { oid, bytes: blob.bytes }
  }

  const changes = async (
    from: Target,
    to: Exclude<Target, { readonly _tag: "Empty" }>,
    paths: ReadonlyArray<string>,
  ) => {
    const inside = (path: string) =>
      paths.length === 0 ||
      paths.some((wanted) => {
        const clean = wanted.replace(/^\.\//, "").replace(/\/+$/, "")
        return (
          clean === "" ||
          clean === "." ||
          path === clean ||
          path.startsWith(`${clean}/`) ||
          clean.startsWith(`${path}/`)
        )
      })
    const found: Array<Change> = []
    await git.walk({
      ...at,
      trees:
        from._tag === "Empty"
          ? [walkerOf(to), git.STAGE()]
          : [walkerOf(from), walkerOf(to), git.STAGE()],
      map: async (path, entries) => {
        const [a = null, b = null, indexed = null] =
          from._tag === "Empty" ? [null, ...entries] : entries
        if (path === ".") return true
        if (!inside(path)) return null
        if (to._tag === "Workdir" && a === null && indexed === null) return null
        const [kindA, kindB] = await Promise.all([a?.type(), b?.type()])
        if (kindA !== "blob" && kindB !== "blob") return true
        const before = kindA === "blob" ? await blobOf(a, from._tag === "Workdir") : null
        const after = kindB === "blob" ? await blobOf(b, to._tag === "Workdir") : null
        if (before?.oid !== after?.oid) found.push({ path, before, after })
        return kindA === "tree" || kindB === "tree" ? true : undefined
      },
    })
    return found.toSorted((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
  }

  const patches = async (list: ReadonlyArray<Change>, overrides: ReadonlyMap<string, string>) => {
    const quoteNonAscii = await quoting(overrides)
    return list
      .map((change) =>
        patch(change, (path) => quotePath(path, { quoteNonAscii, quoteSpace: false })),
      )
      .join("")
  }

  return {
    fs,
    ensure,
    exists,
    head,
    branch,
    config,
    repoConfig,
    setGlobal,
    setRepoConfig,
    identity,
    matrix,
    stage,
    stageAll,
    commit,
    commitAll,
    locked,
    readCommit,
    commits,
    history,
    readBlob,
    show,
    porcelain,
    changes,
    patches,
    quoting,
    cache,
  }
}

export type Repo = ReturnType<typeof makeRepo>
