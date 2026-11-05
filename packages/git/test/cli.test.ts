import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as fsp from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { gitCli, openRepo } from "../src/index.ts"
import type { FsClient, Globals } from "../src/index.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const rooted = (root: string): FsClient => {
  const at = (file: string) => path.join(root, file)

  return {
    promises: {
      readFile: async (file: string, options?: { readonly encoding?: "utf-8" }) =>
        await fsp.readFile(at(file), options ?? null),
      writeFile: async (file: string, data: Uint8Array | string) => {
        await fsp.writeFile(at(file), data)
      },
      unlink: async (file: string) => {
        await fsp.unlink(at(file))
      },
      readdir: async (file: string) => await fsp.readdir(at(file)),
      mkdir: async (file: string) => {
        await fsp.mkdir(at(file))
      },
      rmdir: async (file: string) => {
        await fsp.rmdir(at(file))
      },
      stat: async (file: string) => await fsp.stat(at(file)),
      lstat: async (file: string) => await fsp.lstat(at(file)),
      readlink: async (file: string) => await fsp.readlink(at(file)),
      symlink: async (target: string, file: string) => {
        await fsp.symlink(target, at(file))
      },
    },
  }
}

const memoryGlobals = (initial: Record<string, string> = {}): Globals => {
  let config: Readonly<Record<string, string>> = initial

  return {
    read: async () => await Promise.resolve(config),
    write: async (next) => {
      config = await Promise.resolve(next)
    },
  }
}

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Real Git",
  GIT_AUTHOR_EMAIL: "real@example.com",
  GIT_COMMITTER_NAME: "Real Git",
  GIT_COMMITTER_EMAIL: "real@example.com",
  TZ: "America/Los_Angeles",
  LC_ALL: "C",
}

const exitedWith = Schema.decodeUnknownOption(
  Schema.Struct({ status: Schema.Number, stdout: Schema.String, stderr: Schema.String }),
)

const realGit = (root: string, ...args: readonly string[]) => {
  try {
    return {
      stdout: execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
        cwd: root,
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      stderr: "",
      exitCode: 0,
    }
  } catch (error) {
    const { status, stdout, stderr } = Option.getOrThrowWith(exitedWith(error), () => error)

    return { stdout, stderr, exitCode: status }
  }
}

const folder = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(path.join(tmpdir(), "seqno-git-"))
  roots.push(root)

  for (const [file, text] of Object.entries(files)) {
    put(root, file, text)
  }

  return root
}

const put = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}

process.env["TZ"] = "America/Los_Angeles"

const seqno = (
  root: string,
  globals = memoryGlobals({ "user.name": "Bassim", "user.email": "b@example.com" }),
) => {
  const repo = openRepo({ fs: rooted(root), globals, now: () => new Date("2026-11-03T19:21:15Z") })

  const run = gitCli(repo, "demo", () => new Date("2026-11-03T19:21:15Z"))

  const agrees = async (...args: readonly string[]) => {
    const ours = await run(args)
    expect(ours).toEqual(realGit(root, ...args))
  }

  return { repo, run, agrees }
}

describe("commits Logseq's way", () => {
  it("auto commits a new folder, and real git reads the same history", async () => {
    const root = folder({ "journals/2026_11_03.md": "- hello\n", "pages/Tomatoes.md": "- red\n" })
    const { repo } = seqno(root)
    const first = await repo.commitAll("")
    expect(first._tag).toBe("Committed")
    expect(realGit(root, "log", "--format=%an <%ae>|%s").stdout).toBe(
      "Bassim <b@example.com>|Auto saved by Logseq\n",
    )
    expect(realGit(root, "status", "--porcelain").stdout).toBe("")
    expect(realGit(root, "fsck", "--strict").exitCode).toBe(0)
    await expect(repo.commitAll("")).resolves.toEqual({ _tag: "NothingToCommit" })
  })

  it("asks for an identity when none is set, as git's Author identity unknown", async () => {
    const root = folder({ "pages/a.md": "- a\n" })
    const { repo, run } = seqno(root, memoryGlobals())
    await expect(repo.commitAll("")).resolves.toEqual({ _tag: "NoIdentity" })
    expect((await run(["add", "-A"])).exitCode).toBe(0)
    const commit = await run(["commit", "-m", "first"])
    expect(commit.exitCode).toBe(128)
    expect(commit.stderr).toMatch(/^Author identity unknown\n/u)
    expect((await run(["config", "--global", "user.name", "Bassim"])).exitCode).toBe(0)
    expect((await run(["config", "--global", "user.email", "b@example.com"])).exitCode).toBe(0)
    const first = await run(["commit", "-m", "first"])
    expect(first).toMatchObject({ stderr: "", exitCode: 0 })
    expect(first.stdout).toMatch(
      /^\[master \(root-commit\) [0-9a-f]{7}\] first\n 1 file changed, 1 insertion\(\+\)\n create mode 100644 pages\/a\.md\n$/u,
    )
  })

  it("reads commits real git made, and real git reads seqno's", async () => {
    const root = folder({ "pages/a.md": "- one\n" })
    realGit(root, "init", "-q", "-b", "master")
    realGit(root, "add", "-A")
    realGit(root, "commit", "-q", "-m", "from Logseq desktop")
    put(root, "pages/a.md", "- one\n- two\n")
    const { repo } = seqno(root)
    await expect(repo.commitAll("from seqno")).resolves.toMatchObject({ _tag: "Committed" })
    expect(realGit(root, "log", "--format=%s").stdout).toBe("from seqno\nfrom Logseq desktop\n")
    expect(realGit(root, "status", "--porcelain").stdout).toBe("")
    const history = await repo.history("pages/a.md")
    expect(history.map((version) => version.subject)).toEqual(["from seqno", "from Logseq desktop"])
    await expect(repo.show(history[1]?.oid ?? "", "pages/a.md")).resolves.toBe("- one\n")
  })

  it("auto commits only the paths seqno wrote once there is a first commit", async () => {
    const root = folder({ "pages/a.md": "- one\n", "pages/b.md": "- b\n" })
    const { repo } = seqno(root)
    await expect(repo.commitAll("", ["pages/a.md"])).resolves.toMatchObject({ _tag: "Committed" })
    rmSync(path.join(root, "pages/b.md"))
    put(root, "logseq/.recycle/pages_b.md", "- b\n")
    put(root, "pages/a.md", "- one\n- two\n")
    put(root, "pages/outside.md", "- not seqno's\n")
    await expect(
      repo.commitAll("", ["pages/b.md", "logseq/.recycle/pages_b.md"]),
    ).resolves.toMatchObject({
      _tag: "Committed",
    })
    expect(
      realGit(root, "show", "--no-renames", "--name-status", "--format=%s", "HEAD").stdout,
    ).toBe("Auto saved by Logseq\n\nA\tlogseq/.recycle/pages_b.md\nD\tpages/b.md\n")
    expect(realGit(root, "status", "--porcelain").stdout).toBe(
      " M pages/a.md\n?? pages/outside.md\n",
    )
    await expect(repo.commitAll("", [])).resolves.toEqual({ _tag: "NothingToCommit" })
  })
})

describe("answers plugins as git does", () => {
  it("matches git on GitSeq's sync with no remote", async () => {
    const root = folder({ "pages/a.md": "- a\n" })
    realGit(root, "init", "-q", "-b", "master")
    realGit(root, "add", "-A")
    realGit(root, "commit", "-q", "-m", "start")
    put(root, "pages/a.md", "- a\n- b\n")
    const { run, agrees } = seqno(root)
    await agrees("rev-parse", "-q", "--verify", "MERGE_HEAD")
    await agrees("rev-parse", "-q", "--verify", "REBASE_HEAD")
    await agrees("status", "--porcelain")
    await expect(run(["-C", "demo", "add", "-A"])).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    })
    expect((await run(["-C", "demo", "commit", "-m", "gitseq: sync"])).exitCode).toBe(0)
    await agrees("commit", "-m", "again")
    await agrees("update-ref", "refs/gitseq/backup", "HEAD")
    await agrees("rev-parse", "refs/gitseq/backup")
    await agrees("fetch")
    await agrees("rev-list", "--count", "HEAD..@{u}")
    await agrees("rev-list", "--count", "@{u}..HEAD")
    await agrees("-c", "rebase.autostash=false", "rebase", "@{u}")
    await agrees("merge", "@{u}")
    await agrees("merge", "--abort")
    await agrees("rebase", "--abort")
    await agrees("push")
    await agrees("pull")
    await agrees("-c", "core.quotePath=false", "ls-files", "-u")
    await agrees("-c", "core.quotePath=false", "diff", "--name-only", "HEAD~1", "HEAD")
    await agrees("rev-list", "--count", "HEAD")
    await agrees("remote", "-v")
    await agrees("branch", "--show-current")
  })

  // oxlint-disable-next-line vitest/expect-expect -- every agrees call asserts seqno's answer equals real git's
  it("matches git's status, log, show and diff", async () => {
    const root = folder({
      "a.md": "hi\n",
      "pages/b.md": "x\n",
      "pages/c.md": "1\n2\n3\n4\n5\n6\n7\n8\n9\n",
    })

    realGit(root, "init", "-q", "-b", "master")
    realGit(root, "add", "-A")
    realGit(root, "commit", "-q", "-m", "one")
    put(root, "a.md", "hi\nm\n")
    put(root, "pages/c.md", "1\n2\n3\nfour\n5\n6\n7\n8\nnine\n")
    put(root, "pages/with space.md", "s\n")
    put(root, "pages/é.md", "e\n")
    put(root, "fresh/deep/x.md", "x\n")
    realGit(root, "rm", "-q", "--cached", "pages/b.md")
    const { agrees } = seqno(root)
    await agrees("status", "--porcelain")
    await agrees("-c", "core.quotePath=false", "status", "--porcelain")
    await agrees("diff")
    await agrees("diff", "--cached")
    await agrees("diff", "--name-only")
    realGit(root, "add", "-A")
    await agrees("status", "--porcelain")
    await agrees("-c", "core.quotePath=false", "status", "--porcelain")
    await agrees("diff", "--cached")
    realGit(root, "commit", "-q", "-m", "two", "-m", "with a body")
    put(root, "a.md", "changed\n")
    realGit(root, "commit", "-q", "-am", "three")
    await agrees("log", "-100", "--pretty=format:Commit: %C(auto)%h$$$%s$$$%ad", "-p", "a.md")
    await agrees("log")
    await agrees("log", "--oneline")
    await agrees("log", "-2", "--format=%H %an %ae %ai %s")
    await agrees("log", "--date=iso", "--pretty=format:%h %ad")
    await agrees("show", "HEAD~1:a.md")
    await agrees("show", "HEAD")
    await agrees("show", "HEAD~1")
    await agrees("diff", "HEAD~2", "HEAD")
    await agrees("diff", "HEAD~2..HEAD", "--", "pages")
    await agrees("status", "--porcelain")
  })

  it("answers commands it can't run with git's result shape", async () => {
    const root = folder({ "a.md": "hi\n" })
    const { run } = seqno(root)
    await expect(run(["reset", "--hard", "HEAD"])).resolves.toEqual({
      stdout: "",
      stderr: "fatal: seqno runs git in the browser and can't run 'git reset'\n",
      exitCode: 128,
    })
    await expect(run(["-C", "/elsewhere", "status"])).resolves.toEqual({
      stdout: "",
      stderr: "fatal: cannot change to '/elsewhere': No such file or directory\n",
      exitCode: 128,
    })
    expect(readFileSync(path.join(root, ".git", "HEAD"), "utf-8")).toBe("ref: refs/heads/master\n")
  })
})
