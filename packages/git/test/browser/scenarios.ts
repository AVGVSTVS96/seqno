import { makeCli, makeRepo } from "@seqno/git"
import { handleFs, lockIndex } from "@seqno/git/browser"

const folder = async (name: string) =>
  await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })

const put = async (root: FileSystemDirectoryHandle, path: string, text: string) => {
  const parts = path.split("/")
  let dir = root

  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }

  const writable = await (
    await dir.getFileHandle(parts.at(-1) ?? "", { create: true })
  ).createWritable()

  await writable.write(text)
  await writable.close()
}

const globals = () => {
  let config: Readonly<Record<string, string>> = {
    "user.name": "Bassim",
    "user.email": "b@example.com",
  }

  return {
    read: async () => config,
    write: async (next: Readonly<Record<string, string>>) => {
      config = next
    },
  }
}

const graph = async (gitInside: boolean) => {
  const id = crypto.randomUUID()
  const work = await folder(`graph-${id}`)

  const gitdir = gitInside
    ? await work.getDirectoryHandle(".git", { create: true })
    : await folder(`git-${id}`)

  await put(work, "journals/2026_11_03.md", "- hello\n")
  await put(work, "pages/Tomatoes.md", "- red\n")
  await put(work, "updates/web-1/0.loro", "binary")
  await put(work, ".gitignore", "updates/\n")

  const repo = makeRepo({
    fs: handleFs(work, gitdir),
    globals: globals(),
    lock: async () => await lockIndex(gitdir),
  })

  return { work, gitdir, repo, run: makeCli(repo, "demo") }
}

const names = async (dir: FileSystemDirectoryHandle) => {
  const found: string[] = []

  for await (const name of dir.keys()) {
    found.push(name)
  }

  return found.toSorted()
}

const scenarios: Readonly<Record<string, () => Promise<unknown>>> = {
  commitsAndReadsBack: async () => {
    const { work, gitdir, repo, run } = await graph(false)
    const before = await run(["status", "--porcelain"])
    const first = await repo.commitAll("")
    await put(work, "pages/Tomatoes.md", "- red\n- ripe\n")
    const dirty = await run(["status", "--porcelain"])
    const second = await repo.commitAll("ripe")
    const history = await repo.history("pages/Tomatoes.md")

    return {
      before: before.stdout,
      first: first._tag,
      dirty: dirty.stdout,
      second: second._tag,
      log: (await run(["log", "--format=%s"])).stdout,
      history: history.map((version) => version.subject),
      old: await repo.show(history[1]?.oid ?? "", "pages/Tomatoes.md"),
      diff: (await run(["diff", "--name-only", "HEAD~1", "HEAD"])).stdout,
      workFolder: await names(work),
      gitFolder: (await names(gitdir)).filter((name) =>
        ["HEAD", "config", "index", "objects", "refs"].includes(name),
      ),
    }
  },
  usesTheFoldersOwnGit: async () => {
    const { work, repo, run } = await graph(true)
    await repo.commitAll("")
    const dotGit = await work.getDirectoryHandle(".git")
    const held = await lockIndex(dotGit)
    const busy = await repo.commitAll("while locked")
    await held?.()

    return {
      busy: busy._tag,
      log: (await run(["log", "--format=%s"])).stdout,
      head: await (await (await dotGit.getFileHandle("HEAD")).getFile()).text(),
      lockGone: await dotGit.getFileHandle("index.lock").then(
        () => false,
        () => true,
      ),
    }
  },
}

Object.assign(globalThis, {
  gitScenario: async (name: string) =>
    await (scenarios[name]?.() ?? Promise.reject(new Error(`no scenario ${name}`))),
})
